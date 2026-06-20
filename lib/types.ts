export type WardrobeCategory =
  | "body_reference"
  | "top"
  | "bottom"
  | "shoes"
  | "outerwear"
  | "accessory"
  | "other";

export type ClassificationStatus =
  | "manual"
  | "queued"
  | "classifying"
  | "classified"
  | "failed";

export type LaundryStatus =
  | "clean"
  | "worn_once"
  | "rewear_ok"
  | "needs_wash"
  | "drying"
  | "unavailable";

export type WardrobeItem = {
  id: string;
  owner_id: string;
  name: string;
  category: WardrobeCategory;
  subcategory?: string | null;
  brand?: string | null;
  colour?: string | null;
  colour_primary?: string | null;
  colour_secondary?: string | null;
  pattern?: string | null;
  fabric_guess?: string | null;
  size_label?: string | null;
  season?: string | null;
  season_tags?: string[] | null;
  formality?: string | null;
  formality_score?: number | null;
  warmth_score?: number | null;
  weather_suitability?: string[] | null;
  fit_type?: string | null;
  fit_status?: string | null;
  style_tags?: string[] | null;
  tags?: string[] | null;
  condition_notes?: string | null;
  ai_summary?: string | null;
  ai_confidence?: number | null;
  classification_status?: ClassificationStatus | null;
  classification_error?: string | null;
  laundry_status?: LaundryStatus | null;
  last_worn_at?: string | null;
  wear_count?: number | null;
  image_url: string;
  storage_path?: string | null;
  created_at: string;
};

export type WardrobeClassification = {
  is_body_reference: boolean;
  suggested_name: string;
  category: WardrobeCategory;
  subcategory: string;
  brand: string | null;
  primary_colour: string | null;
  secondary_colour: string | null;
  pattern: string | null;
  fabric_guess: string | null;
  fit_type: string | null;
  season_tags: string[];
  formality: string;
  formality_score: number;
  warmth_score: number;
  weather_suitability: string[];
  style_tags: string[];
  condition_notes: string | null;
  body_reference_notes: string | null;
  assistant_summary: string;
  confidence: number;
};
