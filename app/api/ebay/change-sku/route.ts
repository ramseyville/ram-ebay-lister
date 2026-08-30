import { NextRequest, NextResponse } from "next/server";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { guardApiRequest } from "@/lib/api-guard";
import {
  fetchAccountSetup,
  publishListing,
  withdrawOffer,
  republishOffer,
  deleteInventoryItem,
} from "@/lib/ebay/publish";
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
      listing: body.listing,
      images: body.images,
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
