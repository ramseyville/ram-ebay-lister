import { describe, expect, it } from "vitest";
import { needsAiDescription } from "./doctor-bulk";

describe("needsAiDescription", () => {
  it("sends description problems to the AI batch", () => {
    expect(needsAiDescription({ needsRewrite: ["Description is thin (40 words)"] })).toBe(true);
    expect(needsAiDescription({ needsRewrite: ["No measurements in the description"] })).toBe(true);
    expect(needsAiDescription({ needsRewrite: ['Description uses "approx." measurements'] })).toBe(true);
  });

  it("leaves problems a description rewrite can't fix to the free pass", () => {
    expect(needsAiDescription({ needsRewrite: [] })).toBe(false);
    expect(needsAiDescription({ needsRewrite: ["Title is 64 characters (needs 77–80)", "3 eBay fields empty"] })).toBe(false);
  });
});
