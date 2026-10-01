// eBay API constants + credential loading for the web app.
//
// Phase 2 uses a SEPARATE eBay keyset from the Python lister (so the two never
// interfere). These come from environment variables set in Vercel:
//   EBAY_CLIENT_ID      — the App ID (Client ID)
//   EBAY_CLIENT_SECRET  — the Cert ID (Client Secret)
//   EBAY_RU_NAME        — the RuName, whose "auth accepted URL" in the eBay
//                         developer portal must point at this app's callback
//                         (e.g. https://your-app.vercel.app/api/ebay/callback)
//   SESSION_SECRET      — random string used to encrypt the stored eBay token

export const EBAY_OAUTH_URL = "https://auth.ebay.com/oauth2/authorize";
export const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
export const EBAY_INV_BASE = "https://api.ebay.com/sell/inventory/v1";
export const EBAY_ACC_BASE = "https://api.ebay.com/sell/account/v1";
export const EBAY_META_BASE = "https://api.ebay.com/sell/metadata/v1";
export const EBAY_TAX_BASE = "https://api.ebay.com/commerce/taxonomy/v1";
export const EBAY_TRADING = "https://api.ebay.com/ws/api.dll";
// eBay is decommissioning UploadSiteHostedPictures (Trading API) on Sept 30,
// 2026 — replaced by the Media API's createImageFromFile/getImage. Same
// OAuth scope (sell.inventory) already covers this, so no reconnect needed.
export const EBAY_MEDIA_BASE = "https://apim.ebay.com/commerce/media/v1_beta";
// eBay's legacy Finding API (findCompletedItems, used for "sold comps") hit
// end-of-life in February 2025 — confirmed via eBay's own developer forum
// (https://community.ebay.com/t5/RESTful-Buy-APIs-Browse/Finding-API-EOL-in-February-2025).
// It has been silently returning no usable data ever since, which is the
// real cause behind every "Comp lookup failed — no data returned" pricing
// result this app has produced. The Browse API is the live replacement for
// active-listing search (same app-level client-credentials token as the
// Taxonomy API above); there is no direct public replacement for historical
// SOLD data — that requires the restricted Marketplace Insights API, which
// most developer accounts (including this one) aren't approved for.
export const EBAY_BUY_BASE = "https://api.ebay.com/buy/browse/v1";
export const EBAY_MARKETPLACE_ID = "EBAY_US";
export const EBAY_CATEGORY_TREE_ID = "0";

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
].join(" ");

export interface EbayCreds {
  clientId: string;
  clientSecret: string;
  ruName: string;
}

export function getEbayCreds(): EbayCreds {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RU_NAME;
  if (!clientId || !clientSecret || !ruName) {
    throw new Error(
      "eBay is not configured. Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_RU_NAME in Vercel."
    );
  }
  return { clientId, clientSecret, ruName };
}

export function isEbayConfigured(): boolean {
  return Boolean(
    process.env.EBAY_CLIENT_ID &&
      process.env.EBAY_CLIENT_SECRET &&
      process.env.EBAY_RU_NAME
  );
}

export function basicAuthHeader(creds: EbayCreds): string {
  const raw = `${creds.clientId}:${creds.clientSecret}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}
