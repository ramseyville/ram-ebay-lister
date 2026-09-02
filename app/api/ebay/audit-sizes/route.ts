import { NextRequest, NextResponse } from "next/server";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { guardApiRequest } from "@/lib/api-guard";
import { auditListingSizes } from "@/lib/ebay/publish";

// Scans every active listing's Size value against eBay's live taxonomy for
// its category. Read-only — no listing is modified by this route. Can take
// a while for a large inventory (paginated inventory-item fetch + a
// per-listing offer lookup, 5 at a time), so give it real room.
export const maxDuration = 280;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

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
    const results = await auditListingSizes(accessToken);
    const atRisk = results.filter((r) => r.status === "at_risk" || r.status === "no_size_value");
    return NextResponse.json(
      {
        success: true,
        scanned: results.length,
        atRiskCount: atRisk.length,
        atRisk,
        // Full results available if useful later; keep the payload focused
        // on what needs attention for now.
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
