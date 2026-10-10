// eBay number-only item specifics (e.g. "Fabric Weight"): the value must be a
// number greater than 0 with at most one decimal place, or the whole publish
// fails with 25002. The model sometimes fills these with something that only
// looks related ("12-gauge" is a knit gauge, not a weight), so anything that
// isn't plainly a number — optionally with a weight unit — is dropped rather
// than guessed at.

import type { AspectMeta } from "./taxonomy";

// Number-only on eBay even if a category's metadata ever omits the data type.
const KNOWN_NUMERIC = new Set(["Fabric Weight"]);

const NUMBER_WITH_UNIT =
  /^\s*(\d+(?:[.,]\d+)?)\s*(?:gsm|g\/m2|g\/m²|grams?|g|oz|ounces?|lbs?|pounds?)?\.?\s*$/i;

/** A clean eBay number ("8", "7.5"), or null if the text isn't really one. */
export function numericAspectValue(raw: string): string | null {
  const m = String(raw ?? "").match(NUMBER_WITH_UNIT);
  if (!m) return null;
  const n = Math.round(Number(m[1].replace(",", ".")) * 10) / 10;
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n);
}

/** Clean every number-only aspect in place; drop values that aren't numbers. */
export function cleanNumericAspects(aspects: Record<string, string[]>, meta: AspectMeta[]): void {
  const numeric = new Set([...KNOWN_NUMERIC, ...meta.filter((a) => a.dataType === "NUMBER").map((a) => a.name)]);
  for (const name of numeric) {
    if (!aspects[name]) continue;
    const kept = Array.from(
      new Set(aspects[name].map(numericAspectValue).filter((v): v is string => Boolean(v)))
    );
    if (kept.length) aspects[name] = kept;
    else delete aspects[name];
  }
}
