// Deterministic clean-up of the AI-written HTML description, applied after
// generation and again at publish (so listings saved before a rule changed
// still go out right). The prompt asks for all of this too, but the model
// doesn't follow it reliably — these are the rules that must always hold.
//
// Pure module — no server imports — so the client can use it too.

import { CONDITION_PARAGRAPH } from "@/lib/conditions";

// The store sign-off, word for word from the Courthouse Square Deals listing
// protocol. Hard-coded so the model can't reword it or add stats (feedback %,
// sales count) that go stale.
export const STORE_SIGN_OFF =
  "Find more quality men’s clothing, outdoor gear, and collectibles at Courthouse Square Deals on eBay. Ships fast from Texas.";
const SIGN_OFF_HTML = `<p><em>${STORE_SIGN_OFF}</em></p>`;

// eBay's Inventory API rejects product.description over 4000 characters
// (errorId 25718).
export const EBAY_DESCRIPTION_MAX = 4000;

const LEADING_H2 = /^\s*<h2\b[^>]*>[\s\S]*?<\/h2>\s*/i;
// Any italic paragraph is treated as a sign-off — the protocol has exactly
// one, at the end.
const ITALIC_PARAGRAPH = /<p>\s*<em>[\s\S]*?<\/em>\s*<\/p>\s*/gi;
// Sentences quoting store stats ("99.8% positive feedback", "11,000+ sales").
// A "." followed by a digit is a decimal point, not a sentence end.
const STORE_STATS =
  /[^\s.!?<>](?:[^.!?<>]|\.(?=\d))*?(?:positive feedback|\d[\d,]*\+\s*sales)(?:[^.!?<>]|\.(?=\d))*[.!?]?\s*/gi;

/**
 * Normalize a description: no <h2> title at the top (the title is already
 * shown above it on eBay), no store-stat sentences, and exactly one sign-off —
 * ours — at the end.
 */
export function normalizeDescription(html: string): string {
  const body = (html || "")
    .replace(LEADING_H2, "")
    .replace(ITALIC_PARAGRAPH, "")
    .replace(STORE_STATS, "")
    // Drop paragraphs the stat removal left empty.
    .replace(/<p>\s*<\/p>\s*/gi, "")
    .trim();
  return body ? `${body}\n${SIGN_OFF_HTML}` : SIGN_OFF_HTML;
}

/**
 * Shrink an HTML description to fit eBay's length limit without breaking
 * markup. Whole top-level blocks are dropped from the end of the body first
 * (the SEO paragraph, then fabric, measurements…), always keeping the opening,
 * the condition paragraph, and the sign-off. If that still isn't enough, the
 * text is hard-truncated at a tag boundary.
 */
export function fitDescription(html: string, max = EBAY_DESCRIPTION_MAX): string {
  const src = html || "";
  if (src.length <= max) return src;

  // Split into top-level <h2>/<p>/<ul> blocks plus any bare text between
  // them (e.g. an untagged opening sentence, which is always kept).
  const segments = (src.match(/<(h2|p|ul)\b[^>]*>[\s\S]*?<\/\1>|[^<]+|</gi) || [])
    .map((s) => s.trim())
    .filter(Boolean);
  const isDroppable = (s: string, i: number) =>
    /^<(p|ul)\b/i.test(s) && !CONDITION_PARAGRAPH.test(s) && !/^<p>\s*<em>/i.test(s) && i > 0;
  const keep = segments.map(() => true);
  const join = () => segments.filter((_, i) => keep[i]).join("\n");

  for (let i = segments.length - 1; i >= 0 && join().length > max; i--) {
    if (isDroppable(segments[i], i)) keep[i] = false;
  }
  let out = join();
  if (out.length <= max) return out;

  // Last resort: cut at the last complete tag that fits.
  out = out.slice(0, max);
  const lastClose = out.lastIndexOf(">");
  return lastClose > 0 ? out.slice(0, lastClose + 1) : out;
}
