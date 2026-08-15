import { NextRequest, NextResponse } from "next/server";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { guardApiRequest } from "@/lib/api-guard";
import { fetchAccountSetup, publishListing, retireSku } from "@/lib/ebay/publish";
import type { PublishInput } from "@/lib/ebay/publish";

// Same shape as /api/ebay/publish, plus the SKU being retired.
interface ChangeSkuInput extends PublishInput {
  oldSku: string;
}

// This ends up doing a full republish under the hood — give it the same
// room as /api/ebay/publish.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: ChangeSkuInput;
  try {
    body = (await req.json()) as ChangeSkuInput;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const oldSku = (body.oldSku || "").trim();
  const newSku = (body.sku || "").trim();
  if (!oldSku || !newSku || !body.listing || !Array.isArray(body.images) || body.images.length === 0) {
    return NextResponse.json(
      { success: false, error: "Missing old SKU, new SKU, listing, or photos." },
      { status: 400 }
    );
  }
  if (oldSku === newSku) {
    return NextResponse.json(
      { success: false, error: "New SKU must be different from the current one." },
      { status: 400 }
    );
  }

  let accessToken: string | null;
  try {
    accessToken = await accessTokenFromCookie(req.cookies.get(EBAY_COOKIE)?.value);
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
  if (!accessToken) {
    return NextResponse.json(
      { success: false, error: "eBay isn't connected. Connect your account and try again." },
      { status: 401 }
    );
  }

  try {
    const setup = await fetchAccountSetup(accessToken);

    // 1. Publish a fresh listing under the new SKU first — if this fails,
    //    the old listing is untouched and nothing is lost.
    const published = await publishListing(accessToken, setup, {
      sku: newSku,
      listing: body.listing,
      images: body.images,
    });
    if (!published.success) {
      return NextResponse.json(
        { success: false, error: `Could not publish under new SKU "${newSku}": ${published.error}` },
        { status: 502 }
      );
    }

    // 2. New listing is live — now retire the old one.
    const retired = await retireSku(accessToken, oldSku);
    if (!retired.success) {
      // New listing is live either way; just flag that the old one needs
      // manual cleanup rather than losing track of the new listingId.
      return NextResponse.json(
        {
          success: true,
          sku: newSku,
          listingId: published.listingId,
          offerId: published.offerId,
          warning: `New listing is live under "${newSku}" (item #${published.listingId}), but the old SKU "${oldSku}" could not be fully retired: ${retired.error}. You may want to end it manually in Seller Hub.`,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { success: true, sku: newSku, listingId: published.listingId, offerId: published.offerId },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
