// Listing Doctor: order listings oldest-first by custom label (SKU).
// Mark's SKUs are "<bin>-<item>" (1-1 … 1-50, 2-1, …, 312-20), and lower bins
// are older stock, so sort numerically by bin, then item — "1-2" before
// "1-10", "2-1" after "1-50". Anything that doesn't fit the pattern sorts last.

export function skuOrderKey(sku: string): [number, number, string] {
  const m = /^\s*(\d+)\s*-\s*(\d+)/.exec(sku || "");
  if (!m) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, (sku || "").toUpperCase()];
  return [Number(m[1]), Number(m[2]), ""];
}

export function compareSkus(a: string, b: string): number {
  const ka = skuOrderKey(a);
  const kb = skuOrderKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
}
