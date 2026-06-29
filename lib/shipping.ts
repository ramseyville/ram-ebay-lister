// Shipping estimator for eBay listings.
import type { ListingResult, ShippingDimensions } from "./types";
interface ShippingEstimate { weight_oz: number; dimensions: ShippingDimensions; note: string; }
const POLY_MAILER: ShippingDimensions = { length: 12, width: 12, height: 1 };
const SMALL_BOX: ShippingDimensions = { length: 12, width: 12, height: 3 };
const MEDIUM_BOX: ShippingDimensions = { length: 14, width: 12, height: 4 };
const WEIGHTS: Record<string, { oz: number; dims: ShippingDimensions; note: string }> = {
  mens_top: { oz: 14, dims: POLY_MAILER, note: "Shirt - poly mailer" },
  womens_top: { oz: 10, dims: POLY_MAILER, note: "Top - poly mailer" },
  mens_pants: { oz: 20, dims: POLY_MAILER, note: "Pants - poly mailer" },
  mens_jeans: { oz: 24, dims: POLY_MAILER, note: "Jeans - poly mailer" },
  mens_coat: { oz: 48, dims: MEDIUM_BOX, note: "Coat - medium box" },
  womens_coat: { oz: 40, dims: MEDIUM_BOX, note: "Coat - medium box" },
  mens_sweater: { oz: 24, dims: SMALL_BOX, note: "Sweater - small box" },
  mens_shoes: { oz: 48, dims: SMALL_BOX, note: "Shoes - small box" },
  handbag: { oz: 24, dims: SMALL_BOX, note: "Handbag - small box" },
  wallet: { oz: 6, dims: POLY_MAILER, note: "Wallet - poly mailer" },
  mens_clothing: { oz: 16, dims: POLY_MAILER, note: "Clothing - poly mailer" },
  collectible: { oz: 24, dims: SMALL_BOX, note: "Collectible - small box" },
  other: { oz: 16, dims: POLY_MAILER, note: "General item - poly mailer" },
};
function sizeMultiplier(size?: string): number {
  if (!size) return 1; const s = size.toUpperCase();
  if (s.includes("3XL") || s.includes("4XL")) return 1.35;
  if (s.includes("2XL")) return 1.25; if (s.includes("XL")) return 1.15;
  const w = parseInt(s, 10); if (!isNaN(w)) { if (w >= 42) return 1.3; if (w >= 38) return 1.2; if (w >= 34) return 1.1; } return 1;
}
function isHighValue(p?: number | string): boolean { const n = typeof p === "string" ? parseFloat(p) : p; return typeof n === "number" && !isNaN(n) && n >= 75; }
export function estimateShipping(listing: ListingResult): ShippingEstimate {
  const base = WEIGHTS[(listing.category || "other").toLowerCase()] || WEIGHTS["other"];
  let oz = base.oz * sizeMultiplier(listing.size), dims = base.dims, note = base.note;
  if (isHighValue(listing.suggested_price) && dims === POLY_MAILER) { dims = SMALL_BOX; note = note.replace("poly mailer", "small box (high value)"); }
  return { weight_oz: Math.max(4, Math.round(oz)), dimensions: dims, note };
}
export function formatShipping(listing: ListingResult): string {
  const est = estimateShipping(listing);
  const lbs = Math.floor(est.weight_oz / 16), oz = est.weight_oz % 16;
  return (lbs > 0 ? lbs + " lb " + oz + " oz" : oz + " oz") + " - " + est.note;
}
