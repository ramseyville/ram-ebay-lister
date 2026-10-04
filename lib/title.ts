// Deterministic title clean-up. Titles carry only searchable keywords: no
// punctuation or symbols (% & / - etc.), except the $ in the original retail
// price, written bare as "$145" ("MSRP"/"retail" aren't search keywords and
// cost characters). The prompt says so, but the model still slips up, so
// enforce it here.
//
// Pure module — no server imports.

export const TITLE_MIN = 77;
export const TITLE_MAX = 80;

export function titleLengthOk(title: string): boolean {
  return title.length >= TITLE_MIN && title.length <= TITLE_MAX;
}

export function cleanTitle(raw: string): string {
  return (raw || "")
    // A retail price in any of the model's formats becomes a bare "$145".
    .replace(/\$\s*(\d[\d,]*)(?:\.\d{2})?\s*(?:retail|msrp)\b/gi, "$$$1")
    .replace(/\b(?:retail|msrp)\s*\$?\s*(\d[\d,]*)(?:\.\d{2})?/gi, "$$$1")
    .replace(/\b(\d[\d,]*)(?:\.\d{2})?\s+(?:retail|msrp)\b/gi, "$$$1")
    .replace(/\$\s*(\d[\d,]*)\.\d{2}\b/g, "$$$1")
    .replace(/\b(\d+),(\d{3})\b/g, "$1$2")
    // Fabric percentages ("100% Cotton") read as noise once the % is gone.
    .replace(/\b\d{1,3}\s*%\s*/g, "")
    .replace(/\b1\/4\b/g, "Quarter")
    .replace(/\b1\/2\b/g, "Half")
    .replace(/\b3\/4\b/g, "Three Quarter")
    .replace(/\s*&\s*/g, " and ")
    // Apostrophes join rather than split: "Levi's" → "Levis", "Men's" → "Mens".
    .replace(/['’]/g, "")
    // Every other symbol goes; a $ survives only directly before a digit.
    .replace(/(?:(?!\$\d)[^\p{L}\p{N}\s])+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Mark's rule: a retail price only earns title characters when it's over $85.
export const TITLE_PRICE_MIN = 85;

/** Remove any "$N" retail price of $85 or less from a title. */
export function dropLowRetailPrice(title: string, min = TITLE_PRICE_MIN): string {
  return (title || "")
    .replace(/\s*\$(\d+)\b/g, (m, n) => (Number(n) > min ? m : ""))
    .replace(/\s+/g, " ")
    .trim();
}

// Plain color words buyers actually search. Brand color names ("Dark Seas",
// "Blue Nights") aren't search terms; a title needs one of these too.
const PLAIN_COLORS = [
  "black", "white", "gray", "grey", "charcoal", "silver", "blue", "navy", "teal",
  "turquoise", "green", "olive", "yellow", "gold", "orange", "red", "burgundy",
  "maroon", "pink", "purple", "lavender", "brown", "tan", "beige", "khaki",
  "cream", "ivory", "multicolor",
];
const PLAIN_COLOR_RE = new RegExp(`\\b(${PLAIN_COLORS.join("|")})\\b`, "i");

export function hasPlainColor(text: string): boolean {
  return PLAIN_COLOR_RE.test(text || "");
}

/** The first plain color word in the listing's color field, if any. */
export function plainColorFrom(color: string | string[] | undefined): string | null {
  const text = Array.isArray(color) ? color.join(" ") : color || "";
  const m = PLAIN_COLOR_RE.exec(text);
  if (!m) return null;
  return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
}
