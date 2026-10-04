import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { undoLatest } from "@/lib/ebay/doctor-apply";

// Listing Doctor: restore a listing exactly from its backup.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const itemId = String(body?.itemId || "").trim();
  if (!/^\d{6,20}$/.test(itemId)) {
    return NextResponse.json({ ok: false, error: "Missing or invalid eBay item number." }, { status: 400 });
  }

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
    await undoLatest(token, itemId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
