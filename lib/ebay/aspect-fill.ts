// Fill the category's empty item specifics from what the listing already says.
//
// The listing writer never sees eBay's field list for the category (it isn't
// known until publish), so app listings went up missing fields eBay itself
// could have filled — Fabric Wash, Garment Care, Pocket Type, Rise, Season,
// Theme, Waist Size… This runs at publish, once the category's aspects are
// loaded: one small, cheap text-only model call that picks values for the
// EMPTY fields only, using eBay's exact dropdown wording, and leaves anything
// the listing doesn't support blank. A few of the listing's eBay-hosted photos
// go along too, so visual fields (Fabric Wash, Pocket Type, Pattern…) can be
// read the way eBay's own suggestions are. reconcileAspects() then validates every
// value against eBay's lists as usual, so a bad pick can't reach eBay.

import { getClient, parseModelJson } from "@/lib/anthropic";
import type { ListingResult } from "@/lib/types";
import type { AspectMeta } from "./taxonomy";

const FILL_MODEL = "claude-haiku-4-5-20251001";
// Longer value lists (Brand, Model…) aren't worth sending; those fields are
// either already filled or not something to pick from a list of thousands.
const MAX_LISTED_VALUES = 120;
// Fields the publish code already decides itself.
const SKIP = new Set(["Brand", "Size", "Size Type", "Department", "Handmade", "Personalize", "Personalized", "Unit Type", "Unit Quantity"]);

function plainText(html: string): string {
  return (html || "")
    .replace(/<\/(p|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export async function fillMissingAspects(
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
  listing: ListingResult,
  photoUrls: string[] = []
): Promise<string[]> {
  const empty = meta.filter(
    (a) =>
      a.name &&
      !SKIP.has(a.name) &&
      !(aspects[a.name]?.length && aspects[a.name][0]) &&
      (a.mode === "FREE_TEXT" || a.values.length <= MAX_LISTED_VALUES)
  );
  if (!empty.length) return [];

  const fields = empty
    .map((a) => {
      const kind = a.mode === "SELECTION_ONLY" ? "choose exactly one of" : "free text; eBay's usual values";
      const many = a.multi ? " (several values allowed)" : "";
      const vals = a.values.slice(0, MAX_LISTED_VALUES);
      return `- ${a.name}${many}: ${vals.length ? `${kind}: ${vals.join(" | ")}` : "free text"}`;
    })
    .join("\n");

  const facts = [
    `Title: ${listing.title || ""}`,
    listing.brand ? `Brand: ${listing.brand}` : "",
    listing.item_type ? `Item type: ${listing.item_type}` : "",
    listing.size ? `Size: ${listing.size}` : "",
    listing.color ? `Color: ${Array.isArray(listing.color) ? listing.color.join(", ") : listing.color}` : "",
    listing.material ? `Material: ${listing.material}` : "",
    listing.condition ? `Condition: ${listing.condition}` : "",
    listing.measurements ? `Measurements: ${listing.measurements}` : "",
    Object.keys(aspects).length
      ? `Item specifics already set: ${Object.entries(aspects).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ")}`
      : "",
    `Description:\n${plainText(listing.description).slice(0, 3500)}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const resp = await getClient().messages.create(
      {
        model: FILL_MODEL,
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              ...photoUrls
                .filter((u) => /^https?:\/\/i\.ebayimg\.com\//.test(u))
                .slice(0, 3)
                .map((u) => ({ type: "image" as const, source: { type: "url" as const, url: u.replace(/^http:/, "https:") } })),
              {
                type: "text" as const,
                text: `Fill in eBay item specifics for this listing${photoUrls.length ? " (photos of the item are above)" : ""}.

LISTING:
${facts}

EMPTY eBay FIELDS for this category:
${fields}

Rules:
- Fill a field ONLY if the listing or the photos clearly support it (stated, plainly visible, or a direct, obvious consequence — e.g. jeans with a 5-pocket layout → Pocket Type "5-Pocket Design"; a medium-blue denim wash → Fabric Wash "Medium"; a size "32x30" → Waist Size "32 in", Inseam "30 in"). Otherwise leave it out. Never guess.
- When a list of values is given, use one of those values EXACTLY as written.
- Season / Occasion / Theme / Style-type fields: only when the item's type, fabric, or description makes it clear.
- Return ONLY JSON: {"Field name": "value"} — or an array of values for fields marked "several values allowed". No other text.`,
              },
            ],
          },
        ],
      },
      { timeout: 30_000, maxRetries: 1 }
    );
    const block = resp.content.find((b) => b.type === "text");
    const picked = parseModelJson<Record<string, string | string[]>>(block && block.type === "text" ? block.text : "{}");
    const filled: string[] = [];
    const allowed = new Map(empty.map((a) => [a.name, a]));
    for (const [name, raw] of Object.entries(picked || {})) {
      const a = allowed.get(name);
      if (!a) continue;
      const vals = (Array.isArray(raw) ? raw : [raw])
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
        .slice(0, a.multi ? 6 : 1);
      if (!vals.length) continue;
      aspects[name] = vals;
      filled.push(name);
    }
    if (filled.length) console.error(`[publish] filled item specifics from listing: ${filled.join(", ")}`);
    return filled;
  } catch (e) {
    // Never block a publish over this — the listing just goes up with fewer fields.
    console.error("[publish] item specifics fill skipped:", e);
    return [];
  }
}
