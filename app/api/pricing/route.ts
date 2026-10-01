import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import Anthropic from "@anthropic-ai/sdk";
import { conditionIdCandidates } from "@/lib/conditions";
import { APPAREL_CATEGORIES } from "@/lib/ebay/size-logic";
import { searchActiveListings } from "@/lib/ebay/taxonomy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const client = new Anthropic();

// Every "Comp lookup failed — no data returned (JSON error)" result this app
// has ever produced traces back to this function calling eBay's legacy
// Finding API (svcs.ebay.com/.../FindingService), which eBay confirms hit
// end-of-life in February 2025 (community.ebay.com/t5/RESTful-Buy-APIs-
// Browse/Finding-API-EOL-in-February-2025). It never had a chance of
// returning data — not eBay flakiness, a dead endpoint.
//
// Replaced with the Browse API (same app-level client-credentials token the
// Taxonomy API calls already use). Important honesty note: Browse only
// searches ACTIVE listings, not sold/completed ones — true sold-comp data
// requires the restricted Marketplace Insights API, which this developer
// account isn't approved for. So this now returns real, current competing
// listings and prices rather than claiming "sold comps" it can't back up.
async function fetchEbayComps(
  brand: string,
  itemType: string,
  size: string,
  condition: string,
  category: string
): Promise<string> {
  const keywords = [brand, itemType, size].filter(Boolean).join(" ");
  // Kept for reference/parity with the publish pipeline's own condition
  // resolution, even though Browse API search doesn't filter by condition ID
  // the way the old Finding API call did — left here in case a future
  // revision adds a condition filter to the search itself.
  void conditionIdCandidates(condition, new Set(), APPAREL_CATEGORIES.has(category));

  const items = await searchActiveListings(keywords, 12);
  if (!items.length) return "No current eBay active listings found for: " + keywords;

  const compLines = items
    .map((it) => `- ${it.price || "?"} — ${it.title}${it.condition ? ` (${it.condition})` : ""}`)
    .join("\n");

  return (
    `CURRENT eBay ACTIVE LISTINGS for "${keywords}" (${items.length} found — ` +
    `asking prices, NOT sold data; eBay's sold-comp API isn't available to this account):\n${compLines}`
  );
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const body = await req.json();
  const { listing, photos } = body as {
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

  const comps = await fetchEbayComps(
    listing.brand ?? "",
    listing.item_type ?? listing.title ?? "",
    listing.size ?? "",
    listing.condition ?? "",
    listing.category ?? ""
  );

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

  const textBlock = {
    type: "text" as const,
    text: `You are an expert eBay reseller pricing analyst. Analyze the photos and the real eBay listing data to recommend a price.

ITEM:
${itemSummary}

${comps}

INSTRUCTIONS:
- Study all photos: front shot shows overall condition; tag/label/hang tag photos show exact brand, size, material, and MSRP
- The MSRP from the hang tag (if visible) is a key pricing anchor — note it prominently
- The listings above are CURRENT ACTIVE asking prices, not sold data — eBay's sold-comp API isn't available to this account. Use them as a ceiling/positioning signal, not a guarantee of what the item will actually sell for, and say so plainly rather than calling them "comps" or implying they're sold prices.
- You have a real web_search tool. Use it — don't skip this — when the photos show enough distinguishing detail (brand + product line name, a style/fabric name on the tag, a distinctive construction detail) to identify the EXACT retail product: search for it, confirm the real current or original MSRP from the brand's own site or a reputable retailer, and note 2-3 specific keywords or phrasing that other real, currently-listed eBay sellers use for this same or a very similar item (search site:ebay.com plus the brand/product line). Cite what you actually found; never state a fact you didn't verify as if you looked it up.
- Only compare same condition: pre-owned to pre-owned, NWT to NWT
- Flag extended size scarcity premium (XL+, waist 38+) if applicable
- If both the active-listing data and web search come up thin, say so explicitly — don't paper over a real data gap with a confident-sounding guess

OUTPUT:
**Comp Summary:** Price range and count from the active listings above (labeled as asking prices, not sold prices), plus anything found via web search
**MSRP:** From hang tag if visible, else from a verified web search result (name the source), else "not found"
**Recommended BIN:** $X.XX with brief rationale
**Best Offer:** Yes/No
**Auto-accept floor:** $X.XX
**Counter guidance:** What to counter below floor
**Confidence:** High / Medium / Low
**Notes:** Scarcity premium, condition flags, or data gaps`,
  };

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1536,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    messages: [{ role: "user", content: [...imageBlocks, textBlock] }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  return NextResponse.json({ ok: true, analysis: text });
}
