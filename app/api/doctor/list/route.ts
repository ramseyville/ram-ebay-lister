import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { listActiveListings } from "@/lib/ebay/trading";
import { compareSkus } from "@/lib/doctor-sku";

// Listing Doctor: all active listings, oldest first by SKU (bin 1 first).
// Read-only. ~18 eBay calls for 3,500 listings.
export const maxDuration = 280;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 20, 1), 200);

  let token: string | null;
  try {
    token = await accessTokenFromCookie(req.cookies.get(EBAY_COOKIE)?.value);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ ok: false, error: "eBay isn't connected. Connect your account and try again." }, { status: 401 });
  }

  try {
    const all = await listActiveListings(token);
    all.sort((a, b) => compareSkus(a.sku, b.sku));
    return NextResponse.json({ ok: true, total: all.length, items: all.slice(0, count) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
