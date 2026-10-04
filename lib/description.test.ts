// lib/description.test.ts
//
// Description clean-up: no <h2> title, the fixed store sign-off, and the
// 4000-character eBay limit.

import { describe, it, expect } from "vitest";
import { STORE_SIGN_OFF, cleanSpecificValue, fitDescription, normalizeDescription } from "@/lib/description";

const SIGN_OFF = `<p><em>${STORE_SIGN_OFF}</em></p>`;

describe("normalizeDescription", () => {
  it("removes the title heading and replaces the AI sign-off with the store's", () => {
    const html =
      "<h2>Bonobos Bomber Jacket</h2>Opening line.<p>Body.</p>" +
      "<p><em>Find more quality men's clothing at Courthouse Square Deals — a Denton, Texas seller with 99.8% positive feedback across 11,000+ sales.</em></p>";
    expect(normalizeDescription(html)).toBe(`Opening line.<p>Body.</p>\n${SIGN_OFF}`);
  });

  it("strips store stats quoted elsewhere in the body", () => {
    const html = "<p>Great jacket. Bought from a seller with 99.8% positive feedback across 11,000+ sales. Ships today.</p>";
    expect(normalizeDescription(html)).toBe(`<p>Great jacket. Ships today.</p>\n${SIGN_OFF}`);
  });

  it("is idempotent", () => {
    const once = normalizeDescription("<p>Body.</p>");
    expect(normalizeDescription(once)).toBe(once);
  });
});

describe("fitDescription", () => {
  const cond = "<p><strong>Condition:</strong> Pre-owned - Excellent.</p>";
  const long = (n: number) => `<p>${"x".repeat(n)}</p>`;

  it("leaves short descriptions untouched", () => {
    const html = `Opening.${cond}${SIGN_OFF}`;
    expect(fitDescription(html)).toBe(html);
  });

  it("drops body blocks from the end, keeping opening, condition and sign-off", () => {
    const body = long(1500);
    const fabric = "<ul><li>100% cotton</li></ul>";
    const seo = long(2500);
    const html = `Opening.${body}<ul><li>Chest 22</li></ul>${fabric}${cond}${seo}${SIGN_OFF}`;
    const out = fitDescription(html);
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out).not.toContain(seo);
    expect(out).toContain(body);
    expect(out).toContain(fabric);
    for (const kept of ["Opening.", cond, SIGN_OFF]) expect(out).toContain(kept);
  });

  it("hard-truncates at a tag boundary when blocks alone can't fit", () => {
    const out = fitDescription(`Opening.${cond}<p><em>${"t".repeat(5000)}</em></p>`);
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out.endsWith(">")).toBe(true);
  });
});

describe("cleanSpecificValue", () => {
  it("strips approx. hedges from item specific values", () => {
    expect(cleanSpecificValue("approx. 27 in")).toBe("27 in");
    expect(cleanSpecificValue("11 in (approx.)")).toBe("11 in");
    expect(cleanSpecificValue("~44 in")).toBe("44 in");
    expect(cleanSpecificValue("Approximately 30")).toBe("30");
    expect(cleanSpecificValue("Wide Leg")).toBe("Wide Leg");
  });
});

describe("no links or citations", () => {
  it("strips links, URLs and citation marks but keeps the text", () => {
    const html =
      '<p>Crafted from 100% linen [1] per <a href="https://www.ralphlauren.com/x">Ralph Lauren</a> (source: ralphlauren.com). See www.example.com/item 【3†source】 for more.</p>';
    expect(normalizeDescription(html)).toBe(
      `<p>Crafted from 100% linen per Ralph Lauren. See for more.</p>\n${SIGN_OFF}`
    );
  });
  it("leaves ordinary parentheses alone", () => {
    expect(normalizeDescription("<p>Waist: 17 in (per side)</p>")).toBe(`<p>Waist: 17 in (per side)</p>\n${SIGN_OFF}`);
  });
});
