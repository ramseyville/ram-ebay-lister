import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import Anthropic from "@anthropic-ai/sdk";
import { MIN_COMPS, compLevels } from "@/lib/comps";
import { categoryIdForKey } from "@/lib/ebay/publish";
import { sizeAspectValue } from "@/lib/ebay/size-logic";
import { searchComps, type ActiveListing } from "@/lib/ebay/taxonomy";
import type { ListingResult } from "@/lib/types";

export const dynamic = "force-dynamic";
// Was 60s, set before this route did any web search. Up to 3 real search
// round-trips (plus image analysis) can now legitimately exceed that —
// found this gap while investigating a same-night FUNCTION_INVOCATION_TIMEOUT
// report right after web search shipped. Raised with real margin, same
// reasoning as the earlier publish/change-sku timeout fix.
export const maxDuration = 150;

const client = new Anthropic();

// Same web-search-capability guard as analyze/route.ts, including the
// explicit opt-in default-off reasoning (serverless cold starts make a
// purely reactive catch-and-retry pay for a failing round trip on most
// requests, not just the first one) — see that file's comment for the
// full explanation. Same env var controls both routes.
const WEB_SEARCH_OPT_IN = process.env.ENABLE_WEB_SEARCH === "true";
let webSearchUnavailable = !WEB_SEARCH_OPT_IN;
function isWebSearchDisabledError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? "").toLowerCase();
  return msg.includes("web search") && (msg.includes("not enabled") || msg.includes("disabled"));
}

// Comps come from the Browse API, which only searches ACTIVE listings —
// true sold data needs the restricted Marketplace Insights API, which this
// developer account isn't approved for. So the analysis gets: active
// competitors matched on eBay's own fields (category, Size, condition), the
// total active supply, and any real sold numbers the seller pastes in from
// eBay's sold search or Terapeak (see lib/comps.ts for the one-click links).
//
// The search starts exact (brand + style + color + size + condition) and
// widens in Mark's order — drop size, then color, then condition — until
// there are at least MIN_COMPS matches.
async function fetchEbayComps(listing: ListingResult): Promise<string> {
  const catKey = String(listing.category || "");
  const categoryId = categoryIdForKey(catKey) || undefined;
  const levels = compLevels(listing);
  const tried: string[] = [];
  let chosen: { label: string; total: number; items: ActiveListing[] } | null = null;

  for (const level of levels) {
    const size = level.size ? sizeAspectValue(level.size, catKey) || level.size : "";
    const res = await searchComps({
      keywords: level.keywords,
      categoryId,
      size,
      conditionIds: level.conditionIds,
      limit: 50,
    });
    if (!res) continue;
    tried.push(`${level.label}: ${res.total} active`);
    if (!chosen || res.total > chosen.total) chosen = { label: level.label, total: res.total, items: res.items };
    if (res.total >= MIN_COMPS) {
      chosen = { label: level.label, total: res.total, items: res.items };
      break;
    }
  }

  if (!chosen || !chosen.items.length) {
    return `No current eBay active listings found (searches tried: ${tried.join("; ") || "eBay unavailable"}).`;
  }

  const prices = chosen.items
    .map((it) => parseFloat(it.price.replace(/[^\d.]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
  const stats = prices.length
    ? `Sample of ${prices.length}: low $${prices[0].toFixed(2)}, median $${median.toFixed(2)}, high $${prices[prices.length - 1].toFixed(2)}.`
    : "";
  const compLines = chosen.items
    .slice(0, 15)
    .map((it) => `- ${it.price || "?"} — ${it.title}${it.condition ? ` (${it.condition})` : ""}`)
    .join("\n");

  return (
    `CURRENT eBay ACTIVE LISTINGS — asking prices, NOT sold data.\n` +
    `Matched on: ${chosen.label}. Total active competing listings at this match level: ${chosen.total}. ${stats}\n` +
    `Search levels tried (most specific first): ${tried.join("; ")}.\n` +
    `Examples:\n${compLines}`
  );
}

// Fixed pricing instructions — identical on every request, so they're sent as
// a cached system prompt (cache reads bill at ~10% of normal input price).
const PRICING_INSTRUCTIONS = `You are an expert eBay reseller pricing analyst. Analyze the photos and the real eBay listing data in the user message to recommend a price.

INSTRUCTIONS:
- Study all photos: front shot shows overall condition; tag/label/hang tag photos show exact brand, size, material, and MSRP
- The MSRP from the hang tag (if visible) is a key pricing anchor — note it prominently
- The active listings in the user message are CURRENT ASKING prices, not sold data. Use them as a ceiling/positioning signal and the total active count as supply/competition. Note the match level used (exact vs. widened) and say how close the comps really are.
- If REAL SOLD DATA was pasted, base the recommended price on it first: give the sold price range and average, and if the pasted data includes sold and active counts (e.g. Terapeak's), give sell-through = sold ÷ (sold + active). Never invent sold numbers. for, and say so plainly rather than calling them "comps" or implying they're sold prices.
- You have a real web_search tool (up to 3 uses) — don't skip this, and don't burn all 3 on one vague search. Spend them deliberately, in this order of priority:
  1. If a style number, product-line name, or distinctive construction detail (e.g. "snap-front varsity," a named fabric/mill) is visible or identifiable from the photos, search for the brand + that specific detail FIRST — confirming the exact product is worth more than a generic brand search, because it's what makes the MSRP and comps trustworthy rather than a category guess.
  2. Once you've confirmed the exact product (or if you can't), search for its real current/original MSRP from the brand's own site or a reputable retailer.
  3. If you have a search left, search site:ebay.com plus the brand/product line to see what real, currently-listed sellers use as keywords/phrasing for this same or a closely matching item — especially useful when the active-listing data above has no close match to this item's specific construction/style.
  Cite what you actually found; never state a fact you didn't verify as if you looked it up. If a search comes up empty, say so and move to the next priority rather than retrying the same query.
- Only compare same condition: pre-owned to pre-owned, NWT to NWT
- Flag extended size scarcity premium (XL+, waist 38+) if applicable
- If both the active-listing data and web search come up thin, say so explicitly — don't paper over a real data gap with a confident-sounding guess

OUTPUT:
**Sold Data:** Sold range, average, and sell-through from the pasted sold data — or "none provided; check sold links"
**Active Competition:** Match level used, total active competing listings, and their asking-price range/median (asking prices, not sold)
**MSRP:** From hang tag if visible, else from a verified web search result (name the source), else "not found"
**Recommended BIN:** $X.XX with brief rationale — price endings: new items (NWT, NWOT, new in box, new with imperfections) end in .95; pre-owned items end in .99
**Best Offer:** Yes (always on; the seller reviews every offer personally — no auto-accept or auto-decline)
**Suggested accept floor:** $X.XX (guidance for the seller's manual review only)
**Counter guidance:** What to counter below floor
**Confidence:** High / Medium / Low
**Notes:** Scarcity premium, condition flags, or data gaps`;

const PRICING_SYSTEM = [
  { type: "text" as const, text: PRICING_INSTRUCTIONS, cache_control: { type: "ephemeral" as const } },
];

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const body = await req.json();
  const { listing, photos, soldNotes } = body as {
    soldNotes?: string;
    listing: {
      title: string;
      brand?: string;
      item_type?: string;
      size?: string;
      category?: string;
      condition?: string;
      condition_notes?: string;
      color?: string | string[];
      item_specifics?: Record<string, string>;
    };
    photos: { mediaType: string; data: string }[];
  };

  if (!listing || !photos?.length) {
    return NextResponse.json({ ok: false, error: "Missing listing or photos." }, { status: 400 });
  }

  const comps = await fetchEbayComps(listing as ListingResult);
  // Real sold numbers the seller copied from eBay's sold search or Terapeak.
  const sold = typeof soldNotes === "string" ? soldNotes.trim().slice(0, 4000) : "";
  const soldBlock = sold
    ? `REAL SOLD DATA pasted by the seller from eBay's sold listings / Terapeak (these are actual sales — weight them above the active asking prices):\n${sold}`
    : "NO SOLD DATA provided this time — the seller can paste sold prices from eBay's sold search or Terapeak and rerun for a sold-based price.";

  const color = Array.isArray(listing.color) ? listing.color.join("/") : (listing.color ?? "");
  const retail =
    listing.item_specifics?.["Retail Price"] ||
    listing.item_specifics?.["Original Retail"] ||
    listing.item_specifics?.["MSRP"] ||
    listing.item_specifics?.["Retail"] || "";

  const itemSummary = [
    "Title: " + listing.title,
    listing.brand     ? "Brand: " + listing.brand         : "",
    listing.item_type ? "Type: " + listing.item_type      : "",
    listing.size      ? "Size: " + listing.size           : "",
    color             ? "Color: " + color                 : "",
    listing.condition ? "Condition: " + listing.condition.replace(/_/g, " ") : "",
    listing.condition_notes ? "Condition notes: " + listing.condition_notes : "",
    retail            ? "Original retail/MSRP: " + retail : "",
  ].filter(Boolean).join("\n");

  const imageBlocks = photos.map((p) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: p.mediaType as "image/jpeg" | "image/png" | "image/webp", data: p.data },
  }));

  // Item-specific data goes in the user turn; the long, fixed instructions
  // live in PRICING_INSTRUCTIONS as a cached system prompt.
  const textBlock = {
    type: "text" as const,
    text: `ITEM:
${itemSummary}

${comps}

${soldBlock}

Price this item now, following the instructions and output format.`,
    // Cache breakpoint at the end of the user turn: web search makes the
    // server re-run the model several times inside one request, and each
    // run re-reads these photos + data. Cached, those re-reads cost ~10%.
    cache_control: { type: "ephemeral" as const },
  };


  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      // Raised back to 3 here (analyze/route.ts stays at 2): pricing
      // accuracy depends directly on verifying the exact product/MSRP, and
      // the prompt above now gives the model explicit priority order so
      // the 3 searches are spent deliberately rather than wasted on a
      // vague first attempt. Worth the extra latency on this route.
      tools: webSearchUnavailable
        ? undefined
        : [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      system: PRICING_SYSTEM,
      messages: [{ role: "user", content: [...imageBlocks, textBlock] }],
    });
  } catch (err) {
    if (isWebSearchDisabledError(err) && !webSearchUnavailable) {
      webSearchUnavailable = true;
      console.error("[pricing] web search is not enabled for this account — disabling it and retrying without it");
      response = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        system: PRICING_SYSTEM,
        messages: [{ role: "user", content: [...imageBlocks, textBlock] }],
      });
    } else {
      throw err;
    }
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  return NextResponse.json({ ok: true, analysis: text });
}
