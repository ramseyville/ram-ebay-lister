// Listing Doctor: the description-only rewrite request (no web search, two
// small photos, no extended thinking), shared by the one-at-a-time test route
// and the overnight Message Batch.

import type Anthropic from "@anthropic-ai/sdk";
import { DESCRIPTION_REWRITE_PROMPT } from "@/lib/prompts";
import { applyConditionToDescription } from "@/lib/conditions";
import { fitDescription, normalizeDescription } from "@/lib/description";
import type { TradingItem } from "./trading";

// Per-token list prices (USD) — kept next to the model IDs they price.
export const DESCRIBE_MODELS = {
  sonnet: { id: "claude-sonnet-5", input: 2 / 1e6, output: 10 / 1e6 },
  haiku: { id: "claude-haiku-4-5-20251001", input: 1 / 1e6, output: 5 / 1e6 },
} as const;
export type DescribeModel = keyof typeof DESCRIBE_MODELS;

/** Message Batches are billed at half the normal price. */
export const BATCH_DISCOUNT = 0.5;

/** eBay photo URL at ~500px — a fraction of the tokens of the 1600px original. */
function smallPhoto(url: string): string {
  return url.replace(/^http:/, "https:").replace(/\/s-l\d+\./, "/s-l500.");
}

type DescribeItem = Pick<TradingItem, "title" | "description" | "conditionName" | "conditionNotes" | "categoryName"> & {
  specifics?: Record<string, string[]>;
  pictures?: string[];
};

export function describeParams(item: DescribeItem, model: DescribeModel): Anthropic.MessageCreateParamsNonStreaming {
  const specifics = Object.entries(item.specifics || {})
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
    .filter((u) => typeof u === "string" && /^https?:\/\/i\.ebayimg\.com\//.test(u))
    .slice(0, 2)
    .map((u) => ({ type: "image" as const, source: { type: "url" as const, url: smallPhoto(u) } }));
  return {
    model: DESCRIBE_MODELS[model].id,
    max_tokens: 2500,
    thinking: { type: "disabled" },
    // Cached for single rewrites and batches alike. Haiku only caches prompts
    // of 4,096+ tokens, so on Haiku this is a no-op until the prompt grows.
    system: [{ type: "text", text: DESCRIPTION_REWRITE_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [...photos, { type: "text", text: `EXISTING LISTING:\n${facts}` }] }],
  };
}

/** The model's reply → a clean eBay description with the listing's real condition. */
export function finishDescription(message: Anthropic.Message, conditionText: string): string {
  const html = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  if (!html) throw new Error("The AI returned an empty description.");
  let description = normalizeDescription(html);
  if (conditionText) description = applyConditionToDescription(description, conditionText);
  return fitDescription(description);
}

export function describeCost(usage: Anthropic.Usage, model: DescribeModel, batch = false): number {
  const m = DESCRIBE_MODELS[model];
  const cost =
    (usage.input_tokens || 0) * m.input +
    (usage.output_tokens || 0) * m.output +
    (usage.cache_creation_input_tokens || 0) * m.input * 1.25 +
    (usage.cache_read_input_tokens || 0) * m.input * 0.1;
  return batch ? cost * BATCH_DISCOUNT : cost;
}
