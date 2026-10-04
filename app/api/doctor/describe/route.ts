import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { getClient } from "@/lib/anthropic";
import { DESCRIPTION_REWRITE_PROMPT } from "@/lib/prompts";
import { applyConditionToDescription } from "@/lib/conditions";
import { fitDescription, normalizeDescription } from "@/lib/description";

// Listing Doctor: description-only rewrite (no web search, two small photos,
// no extended thinking). Returns the new description and its exact AI cost.
// Read-only — nothing is written to eBay.
export const maxDuration = 120;

// Per-token list prices (USD) — kept next to the model IDs they price.
const MODELS = {
  sonnet: { id: "claude-sonnet-5", input: 2 / 1e6, output: 10 / 1e6 },
  haiku: { id: "claude-haiku-4-5-20251001", input: 1 / 1e6, output: 5 / 1e6 },
} as const;

/** eBay photo URL at ~500px — a fraction of the tokens of the 1600px original. */
function smallPhoto(url: string): string {
  return url.replace(/^http:/, "https:").replace(/\/s-l\d+\./, "/s-l500.");
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const modelKey = body?.model === "haiku" ? "haiku" : "sonnet";
  const model = MODELS[modelKey];
  const item = body?.item;
  const conditionText = String(body?.conditionText || "");
  if (!item || typeof item.title !== "string") {
    return NextResponse.json({ ok: false, error: "Missing listing data." }, { status: 400 });
  }

  const specifics = Object.entries((item.specifics || {}) as Record<string, string[]>)
    .map(([k, v]) => `${k}: ${(v || []).join(", ")}`)
    .join("; ");
  const oldText = String(item.description || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  const facts = [
    `Title: ${item.title}`,
    `Condition: ${item.conditionName || ""}${item.conditionNotes ? ` — ${item.conditionNotes}` : ""}`,
    `Category: ${item.categoryName || ""}`,
    specifics ? `Item specifics: ${specifics}` : "",
    `Old description: ${oldText}`,
  ]
    .filter(Boolean)
    .join("\n");
  const photos = (Array.isArray(item.pictures) ? item.pictures : [])
    .filter((u: unknown) => typeof u === "string" && /^https?:\/\/i\.ebayimg\.com\//.test(u as string))
    .slice(0, 2)
    .map((u: string) => ({ type: "image" as const, source: { type: "url" as const, url: smallPhoto(u) } }));

  try {
    const resp = await getClient().messages.create(
      {
        model: model.id,
        max_tokens: 2500,
        thinking: { type: "disabled" },
        system: DESCRIPTION_REWRITE_PROMPT,
        messages: [{ role: "user", content: [...photos, { type: "text", text: `EXISTING LISTING:\n${facts}` }] }],
      },
      { timeout: 90_000, maxRetries: 1 }
    );
    const html = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .replace(/^```(?:html)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    if (!html) throw new Error("The AI returned an empty description.");
    let description = normalizeDescription(html);
    if (conditionText) description = applyConditionToDescription(description, conditionText);
    description = fitDescription(description);

    const u = resp.usage;
    const cost = (u.input_tokens || 0) * model.input + (u.output_tokens || 0) * model.output;
    return NextResponse.json({
      ok: true,
      description,
      cost,
      tokens: { input: u.input_tokens, output: u.output_tokens },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
