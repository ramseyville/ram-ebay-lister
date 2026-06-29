import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req); if (denied) return denied;
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ categoryId: null });
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) return NextResponse.json({ categoryId: null });
  try { const { suggestLeafCategory } = await import("@/lib/ebay/taxonomy"); const categoryId = await suggestLeafCategory(q); return NextResponse.json({ categoryId: categoryId ?? null }); }
  catch { return NextResponse.json({ categoryId: null }); }
}
