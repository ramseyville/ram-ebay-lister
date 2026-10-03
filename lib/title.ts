// Deterministic title clean-up. The listing protocol allows only searchable
// keywords in a title: no punctuation or symbols of any kind ($ % & / - etc.).
// The prompt says so, but the model still slips them in, so enforce it here.
//
// Pure module — no server imports.

export const TITLE_MIN = 77;
export const TITLE_MAX = 80;

export function titleLengthOk(title: string): boolean {
  return title.length >= TITLE_MIN && title.length <= TITLE_MAX;
}

export function cleanTitle(raw: string): string {
  return (raw || "")
    // A retail price in any of the model's formats becomes "MSRP 145".
    .replace(/\$\s*(\d[\d,]*)(?:\.\d{2})?\s*(?:retail|msrp)\b/gi, "MSRP $1")
    .replace(/\b(?:retail|msrp)\s*\$\s*(\d[\d,]*)(?:\.\d{2})?/gi, "MSRP $1")
    .replace(/\$\s*(\d[\d,]*)(?:\.\d{2})?/g, "MSRP $1")
    .replace(/\b(\d+),(\d{3})\b/g, "$1$2")
    // Fabric percentages ("100% Cotton") read as noise once the % is gone.
    .replace(/\b\d{1,3}\s*%\s*/g, "")
    .replace(/\b1\/4\b/g, "Quarter")
    .replace(/\b1\/2\b/g, "Half")
    .replace(/\b3\/4\b/g, "Three Quarter")
    .replace(/\s*&\s*/g, " and ")
    // Apostrophes join rather than split: "Levi's" → "Levis", "Men's" → "Mens".
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
