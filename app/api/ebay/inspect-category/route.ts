import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";

// Read-only diagnostic: returns eBay's OWN current Size/Size Type (and any
// other) aspect definitions for a given leaf category, straight from
// getItemAspectsForCategory. No user OAuth needed — categoryAspects() uses
// the app-level client-credentials token, same as the live publish path.
//
// Exists to answer "what values does eBay actually accept here right now"
// with real data instead of guessing after an errorId 25129 ("no longer
// support custom values") — those errors point here by name. Hit this once
// per category ID in question, e.g.:
//   /api/ebay/inspect-category?id=57991   (mens_top / Dress Shirts)
//   /api/ebay/inspect-category?id=11554   (womens_jeans)
export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ success: false, error: "Pass ?id=<categoryId>" }, { status: 400 });
  }
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return NextResponse.json(
      { success: false, error: "EBAY_CLIENT_ID/EBAY_CLIENT_SECRET not configured." },
      { status: 500 }
    );
  }

  try {
    const { categoryAspects } = await import("@/lib/ebay/taxonomy");
    const aspects = await categoryAspects(id);
    // Surface Size/Size Type first since that's almost always why this is
    // being checked, but return everything — a rejected aspect isn't
    // always the one we expected.
    const sizeRelated = aspects.filter((a) => /size/i.test(a.name));
    const other = aspects.filter((a) => !/size/i.test(a.name));
    return NextResponse.json({
      success: true,
      categoryId: id,
      sizeRelated,
      other,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
