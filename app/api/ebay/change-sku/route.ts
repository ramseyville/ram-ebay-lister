import { NextRequest, NextResponse } from "next/server";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { guardApiRequest } from "@/lib/api-guard";
import {
  fetchAccountSetup,
  fetchListingBySku,
  publishListing,
  withdrawOffer,
  republishOffer,
  deleteInventoryItem,
} from "@/lib/ebay/publish";
import type { PublishInput } from "@/lib/ebay/publish";

// Same shape as /api/ebay/publish, plus the SKU being retired. listing and
// images are now OPTIONAL: when omitted (e.g. renaming a SKU from an item
// no longer loaded in the app's current batch), the listing is rebuilt
// directly from what's already live on eBay for oldSku instead.
interface ChangeSkuInput extends Partial<PublishInput> {
  oldSku: string;
  sku: string;
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
  const hasLocalData = !!body.listing && Array.isArray(body.images) && body.images.length > 0;
  if (!oldSku || !newSku) {
    return NextResponse.json(
      { success: false, error: "Missing old SKU or new SKU." },
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

    // If the caller didn't hand us listing data directly (the normal case
    // once the app's been reset for a new batch), rebuild it from what's
    // already live on eBay for the old SKU.
    let listing = body.listing;
    let images = body.images;
    let existingImageUrls: string[] | undefined;
    if (!hasLocalData) {
      const fetched = await fetchListingBySku(accessToken, oldSku);
      if (!fetched.success) {
        return NextResponse.json(
          { success: false, error: `Could not read SKU "${oldSku}" back from eBay to rebuild it: ${fetched.error}` },
          { status: 502 }
        );
      }
      listing = fetched.listing;
      images = [];
      existingImageUrls = fetched.imageUrls;
    }

    // 1. Withdraw the old listing FIRST. eBay's duplicate-listing detection
    //    compares a new offer against currently ACTIVE listings — publishing
    //    the new SKU while the old one is still live gets rejected as a
    //    duplicate of itself (error 25002). Withdrawing just unpublishes it;
    //    the offer and inventory item still exist, so it can be restored if
    //    step 2 fails.
    const withdrawn = await withdrawOffer(accessToken, oldSku);
    if (!withdrawn.success) {
      return NextResponse.json(
        { success: false, error: `Could not prep old SKU "${oldSku}" for the swap: ${withdrawn.error}` },
        { status: 502 }
      );
    }

    // 2. Publish the new SKU.
    const published = await publishListing(accessToken, setup, {
      sku: newSku,
      listing: listing!,
      images: images!,
      existingImageUrls,
    });

    if (!published.success) {
      // Roll back — restore the old listing rather than leaving the seller
      // with nothing live.
      if (withdrawn.wasLive && withdrawn.offerId) {
        const restored = await republishOffer(accessToken, withdrawn.offerId);
        if (!restored.success) {
          return NextResponse.json(
            {
              success: false,
              error: `Publish under new SKU "${newSku}" failed (${published.error}), AND restoring the old listing also failed (${restored.error}). The old SKU "${oldSku}" may currently be OFFLINE — check Seller Hub and republish it manually if needed.`,
            },
            { status: 502 }
          );
        }
      }
      return NextResponse.json(
        {
          success: false,
          error: `Could not publish under new SKU "${newSku}": ${published.error}. The old listing under "${oldSku}" was restored — nothing changed.`,
        },
        { status: 502 }
      );
    }

    // 3. New listing is live — clean up the old inventory record.
    const deleted = await deleteInventoryItem(accessToken, oldSku);
    if (!deleted.success) {
      return NextResponse.json(
        {
          success: true,
          sku: newSku,
          listingId: published.listingId,
          offerId: published.offerId,
          warning: `New listing is live under "${newSku}" (item #${published.listingId}), but the old SKU "${oldSku}"'s inventory record couldn't be deleted: ${deleted.error}. Not urgent — it's inactive.`,
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
