// eBay Trading API (XML) — used by the Listing Doctor to read and revise
// listings that were NOT created by this app (Seller Hub, older tools).
// The Inventory API can't see those; Trading can, with the same OAuth user
// token the app already holds (sent as X-EBAY-API-IAF-TOKEN).

import { EBAY_TRADING } from "./config";

const COMPAT_LEVEL = "1349";

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function xmlUnescape(s: string): string {
  return (s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** First <name>…</name> inside xml (unescaped), or "". */
function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  if (!m) return "";
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
  return cdata ? cdata[1] : xmlUnescape(m[1]);
}

/** First <name>…</name> inside xml, raw (for nested blocks), or "". */
function rawTag(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1] : "";
}

function tagsAll(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

async function call(token: string, callName: string, inner: string): Promise<string> {
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${inner}</${callName}Request>`;
  const resp = await fetch(EBAY_TRADING, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body,
  });
  const text = await resp.text();
  const ack = tag(text, "Ack");
  if (!resp.ok || ack === "Failure") {
    const msg = tag(text, "LongMessage") || tag(text, "ShortMessage") || `HTTP ${resp.status}`;
    throw new Error(`eBay ${callName} failed: ${msg}`);
  }
  return text;
}

export interface ActiveSummary {
  itemId: string;
  sku: string;
  title: string;
}

export function parseActiveListXml(xml: string): ActiveSummary[] {
  return tagsAll(tag(xml, "ActiveList") ? xml : "", "Item").map((it) => ({
    itemId: tag(it, "ItemID"),
    sku: tag(it, "SKU"),
    title: tag(it, "Title"),
  }));
}

/** Every active listing (ID, custom label/SKU, title), all pages. */
export async function listActiveListings(token: string): Promise<ActiveSummary[]> {
  const page = async (n: number) =>
    call(
      token,
      "GetMyeBaySelling",
      `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${n}</PageNumber></Pagination></ActiveList>` +
        `<OutputSelector>ActiveList.ItemArray.Item.ItemID</OutputSelector>` +
        `<OutputSelector>ActiveList.ItemArray.Item.SKU</OutputSelector>` +
        `<OutputSelector>ActiveList.ItemArray.Item.Title</OutputSelector>` +
        `<OutputSelector>ActiveList.PaginationResult</OutputSelector>`
    );
  const parse = parseActiveListXml;
  const first = await page(1);
  const pages = Number(tag(first, "TotalNumberOfPages")) || 1;
  const out = parse(first);
  // A few pages at a time keeps this well inside the function time limit.
  for (let n = 2; n <= pages; n += 4) {
    const batch = await Promise.all(
      [n, n + 1, n + 2, n + 3].filter((p) => p <= pages).map((p) => page(p))
    );
    for (const xml of batch) out.push(...parse(xml));
  }
  return out.filter((i) => i.itemId);
}

export interface TradingItem {
  itemId: string;
  sku: string;
  title: string;
  description: string; // HTML
  price: number;
  conditionId: number;
  conditionName: string;
  conditionNotes: string;
  categoryId: string;
  categoryName: string; // full path, e.g. "Clothing, Shoes & Accessories:Men:…"
  specifics: Record<string, string[]>;
  pictures: string[];
  bestOfferEnabled: boolean;
  startTime: string;
  watchCount: number;
  url: string;
}

export async function getItem(token: string, itemId: string): Promise<TradingItem> {
  const xml = await call(
    token,
    "GetItem",
    `<ItemID>${xmlEscape(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel>` +
      `<IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeWatchCount>true</IncludeWatchCount>`
  );
  return parseItemXml(xml);
}

export function parseItemXml(xml: string): TradingItem {
  const item = xml.indexOf("<Item>") >= 0 ? xml.slice(xml.indexOf("<Item>")) : xml;
  const specifics: Record<string, string[]> = {};
  for (const nvl of tagsAll(rawTag(item, "ItemSpecifics"), "NameValueList")) {
    const name = tag(nvl, "Name");
    if (!name) continue;
    specifics[name] = tagsAll(nvl, "Value").map(xmlUnescape).filter(Boolean);
  }
  const primary = rawTag(item, "PrimaryCategory");
  const pictureBlock = rawTag(item, "PictureDetails");
  const bestOffer = rawTag(item, "BestOfferDetails");
  return {
    itemId: tag(item, "ItemID"),
    sku: tag(item, "SKU"),
    title: tag(item, "Title"),
    description: tag(item, "Description"),
    price: parseFloat(tag(item, "StartPrice")) || parseFloat(tag(item, "CurrentPrice")) || 0,
    conditionId: Number(tag(item, "ConditionID")) || 0,
    conditionName: tag(item, "ConditionDisplayName"),
    conditionNotes: tag(item, "ConditionDescription"),
    categoryId: tag(primary, "CategoryID"),
    categoryName: tag(primary, "CategoryName"),
    specifics,
    pictures: tagsAll(pictureBlock, "PictureURL").map(xmlUnescape),
    bestOfferEnabled: tag(bestOffer, "BestOfferEnabled") === "true",
    startTime: tag(item, "StartTime"),
    watchCount: Number(tag(item, "WatchCount")) || 0,
    url: tag(item, "ViewItemURL"),
  };
}

export interface ReviseFields {
  title?: string;
  description?: string; // HTML
  price?: number;
  categoryId?: string;
  specifics?: Record<string, string[]>; // replaces ALL item specifics
  bestOfferEnabled?: boolean; // auto-accept/decline are never touched
}

function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/** Revise a live listing in place (keeps item number, watchers, sales history). */
export async function reviseItem(token: string, itemId: string, f: ReviseFields): Promise<void> {
  const parts = [`<ItemID>${xmlEscape(itemId)}</ItemID>`];
  if (f.title !== undefined) parts.push(`<Title>${xmlEscape(f.title.slice(0, 80))}</Title>`);
  if (f.description !== undefined) parts.push(`<Description>${cdata(f.description)}</Description>`);
  if (f.price !== undefined && f.price > 0) parts.push(`<StartPrice>${f.price.toFixed(2)}</StartPrice>`);
  if (f.categoryId) parts.push(`<PrimaryCategory><CategoryID>${xmlEscape(f.categoryId)}</CategoryID></PrimaryCategory>`);
  if (f.specifics) {
    const lists = Object.entries(f.specifics)
      .filter(([name, vals]) => name && vals.length)
      .map(
        ([name, vals]) =>
          `<NameValueList><Name>${xmlEscape(name)}</Name>${vals.map((v) => `<Value>${xmlEscape(v)}</Value>`).join("")}</NameValueList>`
      )
      .join("");
    parts.push(`<ItemSpecifics>${lists}</ItemSpecifics>`);
  }
  if (f.bestOfferEnabled !== undefined) {
    parts.push(`<BestOfferDetails><BestOfferEnabled>${f.bestOfferEnabled}</BestOfferEnabled></BestOfferDetails>`);
  }
  await call(token, "ReviseFixedPriceItem", `<Item>${parts.join("")}</Item>`);
}
