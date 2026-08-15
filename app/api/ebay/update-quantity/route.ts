import { NextRequest, NextResponse } from "next/server";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { guardApiRequest } from "@/lib/api-guard";
import { updateOfferQuantity } from "@/lib/ebay/publish";

interface UpdateQuantityInput {
  sku?: string;
  quantity?: number;
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: UpdateQuantityInput;
  try {
    body = (await req.json()) as UpdateQuantityInput;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const sku = (body.sku || "").trim();
  const quantity = Number(body.quantity);
  if (!sku || !Number.isInteger(quantity) || quantity < 0) {
    return NextResponse.json(
      { success: false, error: "Missing SKU or a valid non-negative whole quantity." },
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
    const result = await updateOfferQuantity(accessToken, sku, quantity);
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
