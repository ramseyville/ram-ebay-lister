// Shipping estimator for eBay listings.
import type { ListingResult, ShippingDimensions } from "./types";
interface ShippingEstimate { weight_oz: number; dimensions: ShippingDimensions; note: string; }

// All clothing — including jackets and coats — ships in a 12×12×1 poly mailer.
// Hard goods and shoes use small boxes only.
const POLY_MAILER: ShippingDimensions = { length: 12, width: 12, height: 1 };
const SMALL_BOX: ShippingDimensions = { length: 12, width: 12, height: 3 };

const WEIGHTS: Record<string, { oz: number; dims: ShippingDimensions; note: string }> = {
  mens_top:       { oz: 14, dims: POLY_MAILER, note: "Shirt - poly mailer 12x12x1" },
  womens_top:     { oz: 10, dims: POLY_MAILER, note: "Top - poly mailer 12x12x1" },
  mens_pants:     { oz: 20, dims: POLY_MAILER, note: "Pants - poly mailer 12x12x1" },
  mens_jeans:     { oz: 24, dims: POLY_MAILER, note: "Jeans - poly mailer 12x12x1" },
  mens_jacket:    { oz: 28, dims: POLY_MAILER, note: "Jacket - poly mailer 12x12x1" },
  mens_coat:      { oz: 32, dims: POLY_MAILER, note: "Coat - poly mailer 12x12x1" },
  womens_jacket:  { oz: 24, dims: POLY_MAILER, note: "Jacket - poly mailer 12x12x1" },
  womens_coat:    { oz: 28, dims: POLY_MAILER, note: "Coat - poly mailer 12x12x1" },
  mens_sweater:   { oz: 20, dims: POLY_MAILER, note: "Sweater - poly mailer 12x12x1" },
  mens_shoes:     { oz: 36, dims: SMALL_BOX,   note: "Shoes - small box 12x12x3" },
  handbag:        { oz: 20, dims: SMALL_BOX,   note: "Handbag - small box 12x12x3" },
  wallet:         { oz:  6, dims: POLY_MAILER, note: "Wallet - poly mailer 12x12x1" },
  mens_clothing:  { oz: 16, dims: POLY_MAILER, note: "Clothing - poly mailer 12x12x1" },
  collectible:    { oz: 24, dims: SMALL_BOX,   note: "Collectible - small box 12x12x3" },
  other:          { oz: 16, dims: POLY_MAILER, note: "General item - poly mailer 12x12x1" },
};

// No size multiplier for clothing — even a 4XL jacket folds flat into a poly
// mailer. The multiplier was pushing coats to 3.5 lbs+ which is wildly wrong.
export function estimateShipping(listing: ListingResult): ShippingEstimate {
  const cat = (listing.category || "other").toLowerCase();
  const base = WEIGHTS[cat] || WEIGHTS["other"];
  return { weight_oz: base.oz, dimensions: base.dims, note: base.note };
}

export function formatShipping(listing: ListingResult): string {
  const est = estimateShipping(listing);
  const lbs = Math.floor(est.weight_oz / 16), oz = est.weight_oz % 16;
  return (lbs > 0 ? lbs + " lb " + oz + " oz" : oz + " oz") + " - " + est.note;
}

