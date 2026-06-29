import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const client = new Anthropic();

async function fetchEbayComps(
  brand: string,
  itemType: string,
  size: string,
  condition: string
): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID;
  if (!clientId) return "eBay comps unavailable (no API key).";

  const keywords = [brand, itemType, size].filter(Boolean).join(" ");
  const conditionId =
    condition?.includes("NEW") ? "1000" :
    condition?.includes("EXCELLENT") ? "3000" :
    condition?.includes("VERY_GOOD") ? "4000" :
    condition?.includes("GOOD") ? "5000" : "3000";

  try {
    const url = new URL("https://svcs.ebay.com/services/search/FindingService/v1");
    url.searchParams.set("OPERATION-NAME", "findCompletedItems");
    url.searchParams.set("SERVICE-VERSION", "1.0.0");
    url.searchParams.set("SECURITY-APPNAME", clientId);
    url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
    url.searchParams.set("keywords", keywords);
    url.searchParams.set("itemFilter(0).name", "SoldItemsOnly");
    url.searchParams.set("itemFilter(0).value", "true");
    url.searchParams.set("itemFilter(1).name", "Condition");
    url.searchParams.set("itemFilter(1).value", conditionId);
    url.searchParams.set("sortOrder", "EndTimeSoonest");
    url.searchParams.set("paginationInput.entriesPerPage", "15");

    const res = await fetch(url.toString());
    const data = await res.json();
    const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item ?? [];

    if (!items.length) return "No recent eBay sold comps found for: " + keywords;

    const compLines = items.slice(0, 12).map((item: any) => {
      const price = item.sellingStatus?.[0]?.currentPrice?.[0]?.["__value__"];
      const title = item.title?.[0];
      const date  = item.listingInfo?.[0]?.endTime?.[0]?.slice(0, 10);
      return "- $" + parseFloat(price).toFixed(2) + " — " + title + " (sold " + date + ")";
    }).join("\n");

    return "RECENT eBay SOLD COMPS (" + items.length + " found):\n" + compLines;
  } catch (e) {
    return "eBay comp lookup failed: " + (e as Error).message;
  }
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
    listing.condition ?? ""
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
    text: `You are an expert eBay reseller pricing analyst. Analyze the photos and sold comp data to recommend a price.

ITEM:
${itemSummary}

${comps}

INSTRUCTIONS:
- Study all photos: front shot shows overall condition; tag/label/hang tag photos show exact brand, size, material, and MSRP
- The MSRP from the hang tag (if visible) is a key pricing anchor — note it prominently
- Cross-reference the real eBay sold comps above
- Only compare same condition: pre-owned to pre-owned, NWT to NWT
- Flag extended size scarcity premium (XL+, waist 38+) if applicable
- If comps are thin, say so explicitly

OUTPUT:
**Comp Summary:** Price range, how many comps, recency
**MSRP:** From hang tag if visible, or "not visible in photos"
**Recommended BIN:** $X.XX with brief rationale
**Best Offer:** Yes/No
**Auto-accept floor:** $X.XX
**Counter guidance:** What to counter below floor
**Confidence:** High / Medium / Low
**Notes:** Scarcity premium, condition flags, or data gaps`,
  };

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: [...imageBlocks, textBlock] }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  return NextResponse.json({ ok: true, analysis: text });
}
