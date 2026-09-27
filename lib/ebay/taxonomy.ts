// eBay Taxonomy API: resolve the correct LEAF category and its REQUIRED item
// specifics (aspects) with valid values — instead of guessing from a static map.
//
// This fixes the two publish failure modes:
//   • 25005 "not a leaf category" — the static map held parent categories
//     (e.g. womens_shoes → 3034 "Women's Shoes"); eBay only accepts leaves.
//   • 25002 "<aspect> is missing" — required specifics vary per leaf category
//     and SELECTION_ONLY aspects only accept values from eBay's own list
//     (e.g. Department must be "Unisex Adults", never "Unisex Adult").
//
// These endpoints are read-only, app-level data. We authenticate with a
// client-credentials app token (minted + cached here), independent of the
// seller's user token — so this never needs a re-auth or a new user scope.

import {
  EBAY_TAX_BASE,
  EBAY_META_BASE,
  EBAY_MARKETPLACE_ID,
  EBAY_CATEGORY_TREE_ID,
  EBAY_TOKEN_URL,
  basicAuthHeader,
  getEbayCreds,
} from "./config";

export type AspectMode = "FREE_TEXT" | "SELECTION_ONLY";

export interface AspectMeta {
  name: string;
  required: boolean;
  mode: AspectMode;
  values: string[]; // eBay's allowed/suggested values (full list for SELECTION_ONLY)
}

// ── App token (client-credentials), cached in the warm lambda ────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function appToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  const creds = getEbayCreds();
  const resp = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(creds),
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }).toString(),
  });
  if (!resp.ok) throw new Error(`eBay app token failed (${resp.status})`);
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

async function taxGet(path: string): Promise<any | null> {
  const token = await appToken();
  const resp = await fetch(
    `${EBAY_TAX_BASE}/category_tree/${EBAY_CATEGORY_TREE_ID}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "en-US",
      },
    }
  );
  if (!resp.ok) return null;
  return resp.json().catch(() => null);
}

// ── Public API ───────────────────────────────────────────────────────────────

// Resolve the best LEAF category id for a free-text query (title + hint).
// eBay only suggests leaf categories, so the top hit is always publish-safe.
export async function suggestLeafCategory(query: string): Promise<string | null> {
  const q = (query || "").trim().slice(0, 350);
  if (!q) return null;
  try {
    const data = await taxGet(`get_category_suggestions?q=${encodeURIComponent(q)}`);
    const id = data?.categorySuggestions?.[0]?.category?.categoryId;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

const aspectCache = new Map<string, AspectMeta[]>();

// Required + optional aspects for a leaf category, with eBay's allowed values.
export async function categoryAspects(categoryId: string): Promise<AspectMeta[]> {
  if (!categoryId) return [];
  const cached = aspectCache.get(categoryId);
  // Only trust a cached result if it actually has data. An empty array from
  // a prior transient failure or an incomplete eBay response is NOT the
  // same as "we checked and this category genuinely has no aspects" — but
  // `if (cached)` treated them identically, since [] is truthy in JS. That
  // silently poisoned every subsequent listing in the same category for
  // the life of the warm server instance, no matter what else got fixed
  // downstream (retry logic never helped either, since a cache hit never
  // touches the network at all).
  if (cached && cached.length) return cached;
  try {
    const data = await taxGet(
      `get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`
    );
    const out: AspectMeta[] = [];
    for (const a of data?.aspects ?? []) {
      const con = a?.aspectConstraint ?? {};
      const name = String(a?.localizedAspectName ?? "").trim();
      if (!name) continue;
      out.push({
        name,
        required: Boolean(con?.aspectRequired),
        mode: con?.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT",
        values: (a?.aspectValues ?? [])
          .map((v: any) => String(v?.localizedValue ?? "").trim())
          .filter(Boolean),
      });
    }
    // Only cache non-empty results — a genuinely empty response (rare, but
    // possible for some category) gets re-checked next time rather than
    // locked in, since we can't tell "truly no aspects" apart from "eBay
    // hiccuped" from the response alone.
    if (out.length) aspectCache.set(categoryId, out);
    return out;
  } catch {
    return [];
  }
}

export interface ConditionOption {
  id: number;
  name: string; // eBay's conditionDescription, e.g. "New with tags", "Pre-owned"
}

export interface ConditionPolicy {
  required: boolean; // eBay's itemConditionRequired for this category
  conditions: ConditionOption[];
}

const condCache = new Map<string, ConditionPolicy>();

// A leaf category's condition policy (Sell Metadata API). Unlike the helpers
// above this THROWS on failure, so callers that must tell "lookup failed"
// apart from "no conditions" (the inspect-category diagnostic) can.
export async function conditionPolicy(categoryId: string): Promise<ConditionPolicy> {
  if (!categoryId) throw new Error("No category id");
  const cached = condCache.get(categoryId);
  if (cached) return cached;
  const token = await appToken();
  const url =
    `${EBAY_META_BASE}/marketplace/${EBAY_MARKETPLACE_ID}` +
    `/get_item_condition_policies?filter=categoryIds:%7B${encodeURIComponent(categoryId)}%7D`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`eBay condition policy lookup failed (${resp.status}) ${body.slice(0, 300)}`.trim());
  }
  const data = await resp.json().catch(() => null);
  const policies = data?.itemConditionPolicies;
  if (!Array.isArray(policies) || !policies.length) {
    throw new Error(`eBay returned no condition policy for category ${categoryId}`);
  }
  const byId = new Map<number, ConditionOption>();
  let required = false;
  for (const p of policies) {
    if (p?.itemConditionRequired) required = true;
    for (const c of p?.itemConditions ?? []) {
      const id = Number(c?.conditionId);
      if (id && !byId.has(id)) {
        byId.set(id, { id, name: String(c?.conditionDescription ?? "").trim() });
      }
    }
  }
  const policy = { required, conditions: [...byId.values()].sort((a, b) => a.id - b.id) };
  // Only cache a non-empty result, same reasoning as categoryAspects.
  if (policy.conditions.length) condCache.set(categoryId, policy);
  return policy;
}

// Numeric condition IDs eBay accepts for a leaf category (Sell Metadata API).
// Lets us pick a condition the category actually allows — fashion leaves reject
// the classic USED_VERY_GOOD/GOOD/ACCEPTABLE ids (4000/5000/6000), accepting
// only New variants plus 2990/3000/3010, which is the source of error 25021.
// Best-effort: returns an empty set on any failure (publish falls back).
export async function acceptedConditionIds(categoryId: string): Promise<Set<number>> {
  if (!categoryId) return new Set();
  try {
    const { conditions } = await conditionPolicy(categoryId);
    return new Set(conditions.map((c) => c.id));
  } catch {
    return new Set();
  }
}
