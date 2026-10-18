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
  /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|[2-6]X|X-?SMALL|SMALL|MEDIUM|LARGE|X-?LARGE|XX-?LARGE|XXX-?LARGE)$/i;

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
