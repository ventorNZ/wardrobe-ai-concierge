export const wardrobeClassificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_body_reference",
    "suggested_name",
    "category",
    "subcategory",
    "brand",
    "primary_colour",
    "secondary_colour",
    "pattern",
    "fabric_guess",
    "fit_type",
    "season_tags",
    "formality",
    "formality_score",
    "warmth_score",
    "weather_suitability",
    "style_tags",
    "condition_notes",
    "body_reference_notes",
    "assistant_summary",
    "confidence"
  ],
  properties: {
    is_body_reference: {
      type: "boolean",
      description: "True only if the photo is primarily a full-body person reference for virtual try-on."
    },
    suggested_name: {
      type: "string",
      description: "Human-readable item name, for example 'Navy Polo Ralph Lauren zip hoodie'."
    },
    category: {
      type: "string",
      enum: ["body_reference", "top", "bottom", "shoes", "outerwear", "accessory", "other"]
    },
    subcategory: {
      type: "string",
      description: "Specific item type such as t-shirt, polo, dress shirt, quarter zip, hoodie, blazer, jeans, chinos, dress trousers, sneakers, boots, watch, belt, bag."
    },
    brand: {
      type: ["string", "null"],
      description: "Visible or strongly implied brand. Null if not visible or not confident."
    },
    primary_colour: { type: ["string", "null"] },
    secondary_colour: { type: ["string", "null"] },
    pattern: { type: ["string", "null"] },
    fabric_guess: {
      type: ["string", "null"],
      description: "Best visual guess: cotton, denim, wool, fleece, leather, synthetic performance fabric, knit, etc."
    },
    fit_type: {
      type: ["string", "null"],
      description: "Best visual guess: slim, regular, relaxed, oversized, tailored, straight, tapered, unknown."
    },
    season_tags: {
      type: "array",
      items: { type: "string", enum: ["summer", "autumn", "winter", "spring", "all_season"] }
    },
    formality: {
      type: "string",
      enum: ["very_casual", "casual", "smart_casual", "business_casual", "business", "formal"]
    },
    formality_score: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      description: "1 very casual, 10 formal."
    },
    warmth_score: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      description: "1 very light, 10 very warm."
    },
    weather_suitability: {
      type: "array",
      items: { type: "string", enum: ["hot", "mild", "cool", "cold", "rain", "wind", "indoor", "outdoor"] }
    },
    style_tags: {
      type: "array",
      items: { type: "string" },
      description: "Useful styling tags such as modern, executive, relaxed, weekend, candidate_interview, client_meeting, travel, gym, sleepwear."
    },
    condition_notes: {
      type: ["string", "null"],
      description: "Visible wear, wrinkles, scuffs, stains, needs ironing, good condition, unknown."
    },
    body_reference_notes: {
      type: ["string", "null"],
      description: "Only for body references: pose quality, visibility, whether feet are visible, camera angle, lighting."
    },
    assistant_summary: {
      type: "string",
      description: "One concise styling/usefulness summary."
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    }
  }
} as const;
