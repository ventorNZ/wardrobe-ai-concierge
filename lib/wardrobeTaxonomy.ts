import type { WardrobeCategory } from "./types";

export const wardrobeCategories: WardrobeCategory[] = [
  "body_reference",
  "top",
  "bottom",
  "shoes",
  "outerwear",
  "accessory",
  "other"
];

export const laundryStatuses = [
  "clean",
  "worn_once",
  "rewear_ok",
  "needs_wash",
  "drying",
  "unavailable"
] as const;

export const categoryLabels: Record<WardrobeCategory, string> = {
  body_reference: "Body reference",
  top: "Top",
  bottom: "Bottom",
  shoes: "Shoes",
  outerwear: "Outerwear",
  accessory: "Accessory",
  other: "Other"
};

export function safeCategory(input: unknown): WardrobeCategory {
  return wardrobeCategories.includes(input as WardrobeCategory) ? (input as WardrobeCategory) : "other";
}

export function cleanArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}
