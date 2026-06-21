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

export type WardrobeProfile = {
  id: string;
  owner_id: string;
  display_name: string;
  relationship?: string | null;
  style_profile?: string | null;
  default_body_item_id?: string | null;
  is_active?: boolean | null;
  created_at: string;
  updated_at?: string | null;
};

export type WardrobeItemPhoto = {
  id: string;
  wardrobe_item_id: string;
  image_url: string;
  storage_path?: string | null;
  source_item_id?: string | null;
  angle_label?: string | null;
  is_primary?: boolean | null;
  created_at: string;
};

export type WardrobeItem = {
  id: string;
  owner_id: string;
  profile_id?: string | null;
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
  is_archived?: boolean | null;
  canonical_item_id?: string | null;
  angle_count?: number | null;
  image_role?: string | null;
  photos?: WardrobeItemPhoto[];
  created_at: string;
  updated_at?: string | null;
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

export type StylistSession = {
  id: string;
  owner_id: string;
  profile_id?: string | null;
  selected_date: string;
  day_context?: string | null;
  weather_summary?: string | null;
  desired_vibe?: string | null;
  active_body_item_id?: string | null;
  draft_prompt?: string | null;
  last_recommendation?: unknown;
  created_at: string;
  updated_at?: string | null;
};


export type DressMeSession = {
  id: string;
  owner_id: string;
  profile_id?: string | null;
  selected_date: string;
  body_item_id?: string | null;
  selected_item_ids?: string[] | null;
  occasion?: string | null;
  weather_summary?: string | null;
  notes?: string | null;
  last_output_data_url?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type OutfitPreview = {
  id: string;
  owner_id: string;
  profile_id?: string | null;
  stylist_session_id?: string | null;
  look_label: string;
  outfit_item_ids: string[];
  body_item_id?: string | null;
  prompt?: string | null;
  status: "queued" | "generating" | "complete" | "failed";
  output_image_url?: string | null;
  output_base64?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at?: string | null;
};
