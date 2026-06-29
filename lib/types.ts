// Shape of a generated listing. Mirrors the JSON the model returns in the
// Python script's analyze_photos(), plus the routed profile.

export interface ShippingDimensions {
  length: number; // inches
  width: number;
  height: number;
}

export interface ListingResult {
  title: string;
  category?: string;
  category_hint?: string;
  category_id?: string;
  brand?: string;
  item_type?: string;
  color?: string[] | string;
  size?: string;
  material?: string;
  condition?: string;
  condition_notes?: string;
  condition_notes_override?: string; // seller's manual addition/override
  measurements?: string;
  description: string;
  suggested_price?: number | string;
  shipping_weight_oz?: number;       // estimated ounces
  shipping_dimensions?: ShippingDimensions;
  seo_keywords?: string[];
  key_features?: string[];
  item_specifics?: Record<string, string>;
  item_profile?: string;
}

export interface AnalyzeRequestBody {
  // Browser-resized JPEG data URLs or raw base64 strings.
  images: { mediaType: string; data: string }[];
  profile: string;
}

export interface AnalyzeResponse {
  ok: boolean;
  listing?: ListingResult;
  error?: string;
}

export interface SortResponse {
  ok: boolean;
  groups?: { name: string; photoIndices: number[] }[];
  orphanIndices?: number[];
  error?: string;
}

// ── Client-side working model for the bulk flow ──────────────────────────────

export interface Photo {
  id: string;
  previewUrl: string;
  mediaType: string;
  data: string; // base64, no prefix
}

export type ItemStatus = "idle" | "writing" | "done" | "error";

export type PostStatus = "idle" | "posting" | "posted" | "error";

export interface ItemGroup {
  id: string;
  sku: string; // bin reference, e.g. "K75-A"
  name: string;
  photoIds: string[];
  listing?: ListingResult;
  status: ItemStatus;
  error?: string;
  // eBay posting state (Phase 2)
  postStatus?: PostStatus;
  listingId?: string;
  postError?: string;
  itemCost?: number; // seller cost basis in dollars, default 10
}
