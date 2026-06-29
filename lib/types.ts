// Shape of a generated listing.

export interface ShippingDimensions {
  length: number;
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
  condition_notes_override?: string;
  measurements?: string;
  description: string;
  suggested_price?: number | string;
  shipping_weight_oz?: number;
  shipping_dimensions?: ShippingDimensions;
  seo_keywords?: string[];
  key_features?: string[];
  item_specifics?: Record<string, string>;
  item_profile?: string;
}

export interface AnalyzeRequestBody {
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

export interface Photo {
  id: string;
  previewUrl: string;
  mediaType: string;
  data: string;
}

export type ItemStatus = "idle" | "writing" | "done" | "error";
export type PostStatus = "idle" | "posting" | "posted" | "error";

export interface ItemGroup {
  id: string;
  sku: string;
  name: string;
  photoIds: string[];
  listing?: ListingResult;
  status: ItemStatus;
  error?: string;
  postStatus?: PostStatus;
  listingId?: string;
  postError?: string;
}
