// Monthly sales ledger — persists in localStorage, resets by month.
// Builds up as items are posted to eBay throughout the month.
// Download as CSV at any time; last 3 months kept in storage.

const EBAY_FEE_RATE = 0.1235; // Premium Store final value fee rate
const DEFAULT_COST = 10;

export interface LedgerEntry {
  date: string;          // ISO date YYYY-MM-DD
  sku: string;
  title: string;
  brand: string;
  size: string;
  condition: string;
  itemCost: number;
  binPrice: number;
  ebayFee: number;       // binPrice * EBAY_FEE_RATE
  netProceeds: number;   // binPrice - ebayFee
  grossProfit: number;   // netProceeds - itemCost
  marginPct: number;     // grossProfit / binPrice * 100
  listingId: string;
}

function monthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function storageKey(monthYM: string): string {
  return `csd-ledger-${monthYM}`;
}

function calcEntry(
  sku: string,
  title: string,
  brand: string,
  size: string,
  condition: string,
  itemCost: number,
  binPrice: number,
  listingId: string,
  date: Date = new Date()
): LedgerEntry {
  const ebayFee = parseFloat((binPrice * EBAY_FEE_RATE).toFixed(2));
  const netProceeds = parseFloat((binPrice - ebayFee).toFixed(2));
  const grossProfit = parseFloat((netProceeds - itemCost).toFixed(2));
  const marginPct = binPrice > 0
    ? parseFloat(((grossProfit / binPrice) * 100).toFixed(1))
    : 0;
  return {
    date: date.toISOString().slice(0, 10),
    sku, title, brand, size, condition,
    itemCost, binPrice, ebayFee, netProceeds, grossProfit, marginPct, listingId,
  };
}

export function addToLedger(params: {
  sku: string;
  title: string;
  brand?: string;
  size?: string;
  condition?: string;
  itemCost?: number;
  binPrice: number;
  listingId?: string;
}): void {
  const key = storageKey(monthKey());
  try {
    const existing: LedgerEntry[] = JSON.parse(localStorage.getItem(key) || "[]");
    const entry = calcEntry(
      params.sku,
      params.title,
      params.brand || "",
      params.size || "",
      params.condition?.replace(/_/g, " ") || "",
      params.itemCost ?? DEFAULT_COST,
      params.binPrice,
      params.listingId || "",
    );
    // Avoid duplicates by SKU
    const filtered = existing.filter((e) => e.sku !== params.sku);
    filtered.push(entry);
    localStorage.setItem(key, JSON.stringify(filtered));
    pruneOldMonths();
  } catch {
    // localStorage unavailable — silent fail
  }
}

export function getLedgerMonth(monthYM?: string): LedgerEntry[] {
  const key = storageKey(monthYM || monthKey());
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

export function getAvailableMonths(): string[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith("csd-ledger-"))
      .map((k) => k.replace("csd-ledger-", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function pruneOldMonths(): void {
  try {
    const months = getAvailableMonths();
    // Keep only the 3 most recent months
    months.slice(3).forEach((m) => localStorage.removeItem(storageKey(m)));
  } catch {}
}

export function exportLedgerCsv(monthYM?: string): void {
  const ym = monthYM || monthKey();
  const entries = getLedgerMonth(ym);
  if (!entries.length) return;

  const headers = [
    "Date", "SKU", "Title", "Brand", "Size", "Condition",
    "Your Cost", "BIN Price", `eBay Fee (${(EBAY_FEE_RATE * 100).toFixed(2)}%)`,
    "Net Proceeds", "Gross Profit", "Margin %", "eBay Listing ID",
  ];

  const rows = entries.map((e) => [
    e.date, e.sku,
    `"${e.title.replace(/"/g, '""')}"`,
    `"${e.brand.replace(/"/g, '""')}"`,
    e.size, e.condition,
    `$${e.itemCost.toFixed(2)}`,
    `$${e.binPrice.toFixed(2)}`,
    `$${e.ebayFee.toFixed(2)}`,
    `$${e.netProceeds.toFixed(2)}`,
    `$${e.grossProfit.toFixed(2)}`,
    `${e.marginPct}%`,
    e.listingId,
  ].join(","));

  // Summary row
  const totals = entries.reduce(
    (acc, e) => ({
      cost: acc.cost + e.itemCost,
      bin: acc.bin + e.binPrice,
      fee: acc.fee + e.ebayFee,
      net: acc.net + e.netProceeds,
      profit: acc.profit + e.grossProfit,
    }),
    { cost: 0, bin: 0, fee: 0, net: 0, profit: 0 }
  );
  const avgMargin = totals.bin > 0
    ? ((totals.profit / totals.bin) * 100).toFixed(1)
    : "0";

  rows.push(""); // blank line
  rows.push([
    `"TOTALS (${entries.length} items)"`, "", "", "", "", "",
    `$${totals.cost.toFixed(2)}`,
    `$${totals.bin.toFixed(2)}`,
    `$${totals.fee.toFixed(2)}`,
    `$${totals.net.toFixed(2)}`,
    `$${totals.profit.toFixed(2)}`,
    `${avgMargin}%`,
    "",
  ].join(","));

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const monthName = new Date(`${ym}-01`).toLocaleString("default", {
    month: "long", year: "numeric",
  });
  a.href = url;
  a.download = `courthouse-square-deals-${ym}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
