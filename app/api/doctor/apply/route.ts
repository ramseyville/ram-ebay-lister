import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { applyVersion, type DoctorVersion } from "@/lib/ebay/doctor-apply";

// Listing Doctor: back up a live listing to the database, then revise it on
// eBay with the approved version. No backup → no change.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const itemId = String(body?.itemId || "").trim();
  const v = body?.version as DoctorVersion | undefined;
  if (!/^\d{6,20}$/.test(itemId) || !v || typeof v.title !== "string" || typeof v.description !== "string") {
    return NextResponse.json({ ok: false, error: "Missing item number or version to apply." }, { status: 400 });
  }
  if (!v.title.trim() || v.title.length > 80 || v.description.length > 500_000) {
    return NextResponse.json({ ok: false, error: "Title must be 1–80 characters." }, { status: 400 });
  }
  const version: DoctorVersion = {
    title: v.title.trim(),
    description: v.description,
    price: Number(v.price) || 0,
    categoryId: String(v.categoryId || ""),
    specifics: v.specifics && typeof v.specifics === "object" ? v.specifics : {},
  };

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
    const result = await applyVersion(token, itemId, version);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
