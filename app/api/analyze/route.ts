import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getClient, parseModelJson, AnthropicAuthError, anthropicAuthError } from "@/lib/anthropic";
import { guardApiRequest, safeErrorResponse } from "@/lib/api-guard";
import {
  PROFILE_ROUTER_PROMPT,
  buildProfiledAnalysisPrompt,
  normalizeItemProfile,
} from "@/lib/prompts";
import { toImageBlock, type ImageBlock } from "@/lib/images";
import type { AnalyzeRequestBody, ListingResult } from "@/lib/types";

// Analysis can take 30-90s with the expanded prompt + web searches. Pro plan supports 300s.
export const maxDuration = 300;

const ANALYSIS_MODEL = "claude-opus-4-8";
const ROUTER_MODEL = "claude-sonnet-4-6";
const MAX_IMAGES = 12;

function toImageBlocks(images: AnalyzeRequestBody["images"]): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    const block = toImageBlock(img);
    if (block) blocks.push(block);
  }
  return blocks;
}

// Mirrors route_item_profile(): honor a forced profile, else ask the model.
async function routeProfile(
  client: Anthropic,
  imageBlocks: ImageBlock[],
  requested: string
): Promise<string> {
  const forced = normalizeItemProfile(requested);
  if (forced !== "auto") return forced;

  try {
    const resp = await client.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: PROFILE_ROUTER_PROMPT },
          ],
        },
      ],
    });
    const text = firstText(resp);
    const data = parseModelJson<{ profile?: string }>(text);
    const routed = normalizeItemProfile(data?.profile ?? "auto");
    return routed !== "auto" ? routed : "hard_goods";
  } catch (e) {
    // Auth/billing failures must surface, not silently fall back to a profile.
    const fatal = anthropicAuthError(e);
    if (fatal) throw fatal;
    return "hard_goods";
  }
}

function firstText(resp: Anthropic.Message): string {
  const block = resp.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "";
}

// When web_search is enabled the model may emit a text block before the
// tool call (e.g. "Let me check the size chart...") and the real JSON
// payload in a later text block after the search result. Take the LAST
// text block, not the first, so we don't try to parse narration as JSON.
function lastText(resp: Anthropic.Message): string {
  const textBlocks = resp.content.filter((b) => b.type === "text");
  const block = textBlocks[textBlocks.length - 1];
  return block && block.type === "text" ? block.text.trim() : "";
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: AnalyzeRequestBody;
  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.images) || body.images.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Please add at least one photo." },
      { status: 400 }
    );
  }

  const imageBlocks = toImageBlocks(body.images);
  if (imageBlocks.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No readable photos found. Use JPG, PNG, or WebP." },
      { status: 400 }
    );
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }

  try {
    const profile = await routeProfile(client, imageBlocks, body.profile);
    const systemPrompt = buildProfiledAnalysisPrompt(profile);

    // Retry up to 3 times, mirroring the Python analyze_photos() loop.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await client.messages.create({
          model: ANALYSIS_MODEL,
          max_tokens: 4000,
          // Lets the model look up the brand's official size chart for
          // measurements instead of estimating from photos. The prompt
          // requires trying multiple query angles (brand site, retailer
          // cache, general search) before giving up, so allow enough
          // searches for that — cost per item is still small.
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 4,
            },
          ],
          // System prompt is large and identical across requests for the same
          // profile — cache it to cut cost and latency.
          system: [
            {
              type: "text",
              text: systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: [
                ...imageBlocks,
                {
                  type: "text",
                  text: "Analyze these photos and return the listing JSON now.",
                },
              ],
            },
          ],
        });
        const listing = parseModelJson<ListingResult>(lastText(resp));
        listing.item_profile = profile;
        // Return token usage so the client can track cost per listing.
        const usage = {
          input_tokens: resp.usage?.input_tokens ?? 0,
          output_tokens: resp.usage?.output_tokens ?? 0,
          cache_read_input_tokens: (resp.usage as any)?.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: (resp.usage as any)?.cache_creation_input_tokens ?? 0,
        };
        return NextResponse.json({ ok: true, listing, usage });
      } catch (err) {
        const fatal = anthropicAuthError(err);
        if (fatal) throw fatal; // auth/billing won't fix itself on retry
        lastErr = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  } catch (e) {
    if (e instanceof AnthropicAuthError) {
      console.error("[analyze] auth/billing failure:", e.message);
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return safeErrorResponse("analyze", e, "Something went wrong analyzing photos — please try again.");
  }
}


