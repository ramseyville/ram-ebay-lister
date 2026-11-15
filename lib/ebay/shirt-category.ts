// Dress Shirts vs Casual Button-Down Shirts.
//
// The listing writer used to be offered only "mens_top" for any shirt, and
// publish maps mens_top to eBay's Dress Shirts leaf (57991) — so every casual
// button-down (Oxford, gingham, linen, chambray…) was filed as a dress shirt
// unless its title happened to contain "flannel" / "camp shirt" / etc. That
// puts dress-shirt-only fields (Neck Size, Sleeve Length in inches, Cuff Style)
// on a shirt that has none of them.
//
// The clearest real-world signal is how the tag sizes the shirt: dress shirts
// are sized by NECK (and sleeve) — "16", "16.5 34/35" — while casual shirts
// are letter-sized — "M", "XL", "2XL".

const LETTER_SIZE =
  /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|[2-6]X|X-?SMALL|SMALL|MEDIUM|LARGE|X-?LARGE|XX-?LARGE|XXX-?LARGE|[SML]T|X+LT|[2-6]XLT|[2-6]XT|[2-6]XB|[2-6]XLB|X+LB)$/i;

// Words that say "a button-front shirt" (so a letter-sized henley, tank or
// thermal isn't swept in).
const BUTTON_SHIRT =
  /\bBUTTON[\s-]?(?:DOWN|UP|FRONT)\b|\bOXFORD\b|\bCHAMBRAY\b|\bGINGHAM\b|\bSEERSUCKER\b|\bCAMP\b|\bMADRAS\b|\bPOPLIN\b/i;

export function isLetterSize(size: string | undefined | null): boolean {
  return LETTER_SIZE.test(String(size ?? "").trim());
}

/**
 * True when a "mens_top" listing is really a casual button-down: a letter size
 * (not neck/sleeve sizing) on a button-front shirt.
 */
export function looksLikeCasualButtonShirt(input: {
  title?: string;
  item_type?: string;
  size?: string;
  closure?: string;
}): boolean {
  if (!isLetterSize(input.size)) return false;
  const hay = `${input.title ?? ""} ${input.item_type ?? ""}`;
  if (BUTTON_SHIRT.test(hay)) return true;
  return /^button$/i.test(String(input.closure ?? "").trim()) && /\bSHIRT\b/i.test(hay);
}

// A neck-sized tag ("16.5", "16 34/35", "16/16.5 34/35") means a woven DRESS
// shirt. The model sometimes still calls it a "Polo" (e.g. from a product name
// like "Grover Long Sleeve Polo Shirt"). Correct the item type, category and
// title wording after the fact so it never reaches eBay as a polo.
export function fixNeckSizedShirt<T extends { title?: string; size?: string; item_type?: string; category?: string }>(
  listing: T
): boolean {
  const sz = String(listing.size || "").trim();
  const neckSized =
    /^1[3-9](?:\.5)?$/.test(sz) || /^1[3-9](?:\.5|\s+1\/2)?(?:\s*[\/-]\s*1?[3-9](?:\.5)?)?\s*[-,]?\s*\d{2}(?:\s*\/\s*\d{2})?$/.test(sz);
  if (!neckSized) return false;
  const shirtish = /\b(POLO|SHIRT|DRESS|BUTTON|OXFORD|CASUAL)\b/i.test(`${listing.title ?? ""} ${listing.item_type ?? ""}`);
  if (!shirtish) return false;
  let changed = false;
  if (listing.category !== "mens_top" && /^(mens_polo|mens_casual_shirt|mens_tshirt|mens_top|)$/.test(String(listing.category ?? ""))) {
    listing.category = "mens_top";
    changed = true;
  }
  if (/\bPOLO\b/i.test(listing.item_type ?? "") || !listing.item_type) {
    listing.item_type = "Dress Shirt";
    changed = true;
  }
  if (listing.title && /\bPOLO\b/i.test(listing.title) && !/\bDRESS SHIRT\b/i.test(listing.title)) {
    listing.title = listing.title
      .replace(/\b(Long|Short)\s+Sleeve\s+Polo\s+Shirt\b/i, "$1 Sleeve Dress Shirt")
      .replace(/\bPolo\s+Shirt\b/i, "Dress Shirt")
      .replace(/\bPolo\b/i, "Dress Shirt")
      .replace(/\s{2,}/g, " ")
      .trim();
    changed = true;
  }
  return changed;
}
