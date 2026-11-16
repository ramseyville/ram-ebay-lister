import { NextRequest, NextResponse } from "next/server";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { guardApiRequest } from "@/lib/api-guard";
import { uploadPhoto } from "@/lib/ebay/publish";

// One full-size listing photo per request, so a whole listing's worth of
// 1600px photos never has to fit in a single request body (Vercel's limit is
// 4.5 MB). Returns eBay's hosted picture URL for the publish step to reuse.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: { data?: string; mediaType?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  if (!body.data) return NextResponse.json({ ok: false, error: "Missing photo." }, { status: 400 });

  let accessToken: string | null;
  try {
    accessToken = await accessTokenFromCookie(req.cookies.get(EBAY_COOKIE)?.value);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "eBay isn't connected." }, { status: 401 });
  }

  try {
    const url = await uploadPhoto(accessToken, body.data, body.mediaType || "image/jpeg", body.name || "photo.jpg");
    if (!url) return NextResponse.json({ ok: false, error: "eBay did not accept the photo." }, { status: 502 });
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
