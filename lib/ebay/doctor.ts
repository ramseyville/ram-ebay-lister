// Listing Doctor: the free, rule-based ("mechanical") fixes for an existing
// eBay listing, plus the list of problems that need an AI rewrite. Read-only
// — this only PROPOSES changes; nothing here writes to eBay.

import {
  applyConditionToDescription,
  buildConditionText,
  conditionStandard,
  priceWithEnding,
} from "@/lib/conditions";
import { cleanSpecificValue, normalizeDescription } from "@/lib/description";
import { cleanTitle, dropLowRetailPrice, hasPlainColor, needsShirtWord, plainColorFrom, titleLengthOk } from "@/lib/title";
import { categoryAspects } from "./taxonomy";
import type { TradingItem } from "./trading";

export interface DoctorProposal {
  title: string;
  description: string;
  price: number;
  bestOffer: boolean;
  categoryId: string;
  specifics: Record<string, string[]>;
  // The condition statement for this listing's actual eBay condition — the
  // AI rewrite reuses it so the grade never changes.
  conditionText: string;
  changes: string[]; // what the free fixes change
  needsRewrite: string[]; // problems only an AI rewrite can fix
  emptyFields: string[]; // eBay fields for the category with no value
}

const NEW_CONDITION_IDS = new Set([1000, 1500, 1750]);

// An old store sign-off in any wording, as its own paragraph or plain text.
const OLD_SIGN_OFF_P = /<p\b[^>]*>(?:(?!<\/?p\b)[\s\S])*?Courthouse Square Deals(?:(?!<\/?p\b)[\s\S])*?<\/p>/gi;
const OLD_SIGN_OFF_TEXT = /Find more[^.<]*Courthouse Square Deals[^.<]*\.(?:\s*Ships fast from Texas\.)?/gi;

function wordCount(html: string): number {
  return (html || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

/** Keep the sign-off inside the document when an old description is a full HTML page. */
function signOffInsideBody(html: string): string {
  const signOff = html.lastIndexOf("<p><em>");
  const bodyEnd = html.search(/<\/body>/i);
  if (signOff < 0 || bodyEnd < 0 || bodyEnd > signOff) return html;
  const tail = html.slice(signOff);
  const head = html.slice(0, signOff).trimEnd();
  const at = head.search(/<\/body>/i);
  return `${head.slice(0, at)}${tail}\n${head.slice(at)}`;
}

export async function proposeFixes(item: TradingItem): Promise<DoctorProposal> {
  const changes: string[] = [];
  const needsRewrite: string[] = [];
  const isNew = NEW_CONDITION_IDS.has(item.conditionId);
  const apparel = /^Clothing, Shoes/i.test(item.categoryName);

  // ── Category: hoodies/sweatshirts filed under Sweaters ──
  let categoryId = item.categoryId;
  const typeText = `${item.title} ${(item.specifics.Type || []).join(" ")}`;
  if (/sweaters/i.test(item.categoryName) && /\b(hoodies?|hoody|hooded|sweatshirts?)\b/i.test(typeText)) {
    const womens = /:Women/i.test(item.categoryName);
    categoryId = womens ? "155226" : "155183";
    changes.push(`Move from Sweaters to ${womens ? "Women's" : "Men's"} Hoodies & Sweatshirts`);
  }

  // ── Title ──
  let title = dropLowRetailPrice(cleanTitle(item.title));
  if (item.conditionId !== 1000) title = title.replace(/\b(NWT|New With Tags)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  if (title !== item.title) changes.push("Title: remove symbols / retail price of $85 or less / NWT on a non-NWT item");
  if (!titleLengthOk(title)) needsRewrite.push(`Title is ${title.length} characters (needs 77–80)`);
  const plain = plainColorFrom((item.specifics.Color || []).join(" ")) || plainColorFrom(item.title);
  if (!hasPlainColor(title) && (plain || apparel)) needsRewrite.push("Title has no plain color word");
  const itemType = (item.specifics.Type || []).join(" ") || item.categoryName;
  if (needsShirtWord(itemType, title)) needsRewrite.push('Shirt title is missing the word "Shirt"');

  // ── Price ending ──
  const price = item.price > 0 ? priceWithEnding(item.price, isNew ? "NEW_WITH_TAGS" : "GOOD") : item.price;
  if (price !== item.price) changes.push(`Price $${item.price.toFixed(2)} → $${price.toFixed(2)} (${isNew ? ".95 new" : ".99 pre-owned"} ending)`);

  // ── Best Offer (on; auto-accept/decline left untouched) ──
  if (!item.bestOfferEnabled) changes.push("Turn on Best Offer (no auto-accept / auto-decline)");

  // ── Description ──
  const label = item.conditionName || "";
  const conditionText = buildConditionText(label, conditionStandard(item.conditionId, apparel), item.conditionNotes);
  let description = item.description.replace(OLD_SIGN_OFF_P, "").replace(OLD_SIGN_OFF_TEXT, "");
  description = normalizeDescription(description);
  if (label) description = applyConditionToDescription(description, conditionText);
  description = signOffInsideBody(description);
  if (description.trim() !== item.description.trim()) {
    changes.push("Description: current sign-off, condition statement matching the eBay condition, no links/stats/title heading");
  }
  const words = wordCount(item.description);
  if (words < 80) needsRewrite.push(`Description is thin (${words} words)`);
  if (!/\b(chest|waist|inseam|length|width|height|sleeve|rise|diameter|measure)/i.test(item.description)) {
    needsRewrite.push("No measurements in the description");
  }
  if (/\bapprox/i.test(item.description)) needsRewrite.push('Description uses "approx." measurements');

  // ── Item specifics ──
  const meta = await categoryAspects(categoryId).catch(() => []);
  const known = new Set(meta.map((a) => a.name));
  const specifics: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(item.specifics)) {
    const cleaned = values.map(cleanSpecificValue).filter(Boolean);
    if (meta.length && !known.has(name)) {
      changes.push(`Remove non-eBay item specific "${name}"`);
      continue;
    }
    if (cleaned.join("|") !== values.join("|")) changes.push(`Item specific "${name}": remove "approx."`);
    if (cleaned.length) specifics[name] = cleaned;
  }
  if (apparel) {
    for (const [name, value] of [["Unit Type", "Unit"], ["Unit Quantity", "1"]] as const) {
      if (known.has(name) && !specifics[name]?.length) {
        specifics[name] = [value];
        changes.push(`Add ${name}: ${value}`);
      }
    }
  }
  const emptyFields = meta.filter((a) => !specifics[a.name]?.length).map((a) => a.name);
  const offList = meta
    .filter((a) => a.mode === "SELECTION_ONLY" && specifics[a.name]?.some((v) => !a.values.some((x) => x.toLowerCase() === v.toLowerCase())))
    .map((a) => a.name);
  if (offList.length) needsRewrite.push(`Values not on eBay's list: ${offList.join(", ")}`);
  if (emptyFields.length) needsRewrite.push(`${emptyFields.length} eBay fields empty`);

  return {
    title,
    description,
    price,
    bestOffer: true,
    categoryId,
    specifics,
    conditionText,
    changes,
    needsRewrite,
    emptyFields,
  };
}
