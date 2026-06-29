// Builds a pre-filled Claude.ai URL for batch pricing analysis.
import type { ItemGroup } from "./types";

function itemBrief(group: ItemGroup): string {
  const l = group.listing;
  if (!l) return "";
  const color = Array.isArray(l.color) ? l.color.join("/") : (l.color || "");
  const retail = l.item_specifics?.["Retail Price"] || l.item_specifics?.["MSRP"] || "";
  const styleNo = l.item_specifics?.["Style"] || l.item_specifics?.["Style Number"] || "";
  return [
    `SKU: ${group.sku}`,
    `Brand: ${l.brand || "Unknown"}`,
    l.item_type ? `Type: ${l.item_type}` : "",
    styleNo ? `Style #: ${styleNo}` : "",
    l.size ? `Size: ${l.size}` : "",
    color ? `Color: ${color}` : "",
    l.condition ? `Condition: ${l.condition.replace(/_/g, " ")}` : "",
    retail ? `Retail: ${retail}` : "",
  ].filter(Boolean).join("\n");
}

export function buildBatchPricingUrl(groups: ItemGroup[]): string {
  const ready = groups.filter((g) => g.status === "done" && g.listing);
  if (ready.length === 0) return "";
  const itemBlocks = ready.map((g, i) => `--- Item ${i + 1} of ${ready.length} ---\n${itemBrief(g)}`).join("\n\n");
  const prompt = `Please run a full eBay pricing analysis for this batch of ${ready.length} items.\n\n)]MES:\n\n${itemBlocks}`;
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
