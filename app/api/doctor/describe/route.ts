import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { getClient } from "@/lib/anthropic";
import { describeCost, describeParams, finishDescription } from "@/lib/ebay/doctor-describe";

// Listing Doctor: description-only rewrite (no web search, two small photos,
// no extended thinking). Returns the new description and its exact AI cost.
// Read-only — nothing is written to eBay.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const model = body?.model === "haiku" ? "haiku" : "sonnet";
  const item = body?.item;
  const conditionText = String(body?.conditionText || "");
  if (!item || typeof item.title !== "string") {
    return NextResponse.json({ ok: false, error: "Missing listing data." }, { status: 400 });
  }

  try {
    const resp = await getClient().messages.create(describeParams(item, model), { timeout: 90_000, maxRetries: 1 });
    const description = finishDescription(resp, conditionText);
    const u = resp.usage;
    return NextResponse.json({
      ok: true,
      description,
      cost: describeCost(u, model),
      tokens: { input: u.input_tokens, output: u.output_tokens },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
