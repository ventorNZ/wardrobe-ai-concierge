import type { WardrobeItem } from "@/lib/types";

export type DressMode = "casual_family" | "online_work" | "in_person_work" | "elevated" | "formal" | "practical";

export type StyleContextInput = {
  dayContext?: string;
  calendarContext?: string;
  weather?: string;
  vibe?: string;
};

export type StyleContext = {
  mode: DressMode;
  label: string;
  formalityCeiling: number;
  cameraAware: boolean;
  allowSuit: boolean;
  reason: string;
  keywords: string[];
};

const CASUAL_WORDS = /sunday|saturday|weekend|family|kids|children|home|errands|school run|casual|relaxed|park|brunch|lunch|afternoon|bbq|barbecue|coffee|shopping|movies|walk|supermarket|chores|playdate/i;
const ONLINE_WORDS = /online|zoom|teams|google meet|meet link|video|webinar|virtual|remote|camera|call|dial[- ]?in|hangout/i;
const MEETING_WORDS = /meeting|client|presentation|board|exec|office|interview|founder|work|staff|stakeholder|workshop|onsite|in-person|in person/i;
const FORMAL_WORDS = /formal|black tie|wedding|gala|ceremony|funeral|cocktail|suit|tie required|jacket required|dress code/i;
const ELEVATED_WORDS = /dinner|date|restaurant|event|party|birthday|drinks|show|concert|theatre|theater|bar/i;
const LOCATION_WORDS = /office|city|onsite|on-site|in-person|in person|client site|restaurant|venue|school|campus|airport|travel/i;
const LEGACY_FORMAL_VIBE = /polished|client-ready|camera-friendly|business|corporate|executive|formal/i;

export function stripLegacyFormalVibe(vibe?: string | null, dayContext?: string | null) {
  const text = (vibe || "").trim();
  if (!text) return "";
  const day = dayContext || "";
  if (CASUAL_WORDS.test(day) && LEGACY_FORMAL_VIBE.test(text) && !FORMAL_WORDS.test(day)) return "";
  return text;
}

export function inferStyleContext(input: StyleContextInput): StyleContext {
  const vibe = stripLegacyFormalVibe(input.vibe, input.dayContext);
  const day = input.dayContext || "";
  const calendar = input.calendarContext || "";
  const all = `${day}\n${calendar}\n${input.weather || ""}\n${vibe}`;
  const calendarAndDay = `${day}\n${calendar}`;
  const keywords: string[] = [];

  if (FORMAL_WORDS.test(all)) {
    keywords.push("explicit formal dress code");
    return {
      mode: "formal",
      label: "formal",
      formalityCeiling: 10,
      cameraAware: ONLINE_WORDS.test(all),
      allowSuit: true,
      reason: "The brief explicitly includes formal or dress-code language.",
      keywords,
    };
  }

  if (ONLINE_WORDS.test(calendarAndDay) && MEETING_WORDS.test(calendarAndDay)) {
    keywords.push("online meetings");
    return {
      mode: "online_work",
      label: "online work",
      formalityCeiling: 6,
      cameraAware: true,
      allowSuit: false,
      reason: "Calendar/day context points to online meetings, so the look should be smart on camera without a full suit.",
      keywords,
    };
  }

  if (MEETING_WORDS.test(calendarAndDay) && LOCATION_WORDS.test(calendarAndDay)) {
    keywords.push("in-person work");
    return {
      mode: "in_person_work",
      label: "in-person work",
      formalityCeiling: 7,
      cameraAware: false,
      allowSuit: false,
      reason: "The day has in-person work context, so smart separates make more sense than defaulting to a full suit.",
      keywords,
    };
  }

  if (CASUAL_WORDS.test(calendarAndDay) || /casual|relaxed|comfortable|family/i.test(vibe)) {
    keywords.push("casual family day");
    return {
      mode: "casual_family",
      label: "casual family",
      formalityCeiling: 5,
      cameraAware: false,
      allowSuit: false,
      reason: "The day reads as family/weekend/casual, so comfort and weather practicality beat formality.",
      keywords,
    };
  }

  if (ELEVATED_WORDS.test(all)) {
    keywords.push("elevated casual event");
    return {
      mode: "elevated",
      label: "elevated casual",
      formalityCeiling: 6,
      cameraAware: false,
      allowSuit: false,
      reason: "The plan sounds social/elevated, but not formal.",
      keywords,
    };
  }

  if (MEETING_WORDS.test(calendarAndDay)) {
    keywords.push("work context");
    return {
      mode: "online_work",
      label: "work-smart",
      formalityCeiling: 6,
      cameraAware: ONLINE_WORDS.test(all),
      allowSuit: false,
      reason: "The calendar mentions work, but no formal dress code; use smart casual/smart separates rather than a full suit.",
      keywords,
    };
  }

  return {
    mode: "practical",
    label: "practical",
    formalityCeiling: 6,
    cameraAware: false,
    allowSuit: false,
    reason: "No formal context detected; keep it practical and personal.",
    keywords,
  };
}

function textForItem(item: WardrobeItem) {
  return `${item.name || ""} ${item.category || ""} ${item.subcategory || ""} ${item.brand || ""} ${item.formality || ""} ${Array.isArray(item.style_tags) ? item.style_tags.join(" ") : String(item.style_tags || "")} ${item.pattern || ""} ${item.ai_summary || ""}`.toLowerCase();
}

export function itemFormality(item: WardrobeItem) {
  if (typeof item.formality_score === "number" && Number.isFinite(item.formality_score)) return item.formality_score;
  const text = textForItem(item);
  if (/tux|black tie|pinstripe|suit|formal|business|dress shirt|oxford shirt|derby|oxford shoe/.test(text)) return 9;
  if (/blazer|sports coat|sport coat|loafer|dress shoe|tailored trouser|wool trouser/.test(text)) return 7;
  if (/smart|chino|polo|knit|quarter zip|cardigan|overshirt/.test(text)) return 5;
  if (/casual|t.?shirt|tee|hoodie|sweatshirt|sneaker|vans|jean|denim|track|jogger/.test(text)) return 3;
  return 5;
}

export function isSuitOrFormalPiece(item: WardrobeItem) {
  return /pinstripe|suit|formal|business|dress trouser|dress pants|tailored trouser|blazer/.test(textForItem(item)) || itemFormality(item) >= 8;
}

export function isVeryCasualSportPiece(item: WardrobeItem) {
  return /hoodie|sweatshirt|burton|logo|track|gym|sport|jersey|graphic tee/.test(textForItem(item));
}

export function isCameraSmartTop(item: WardrobeItem) {
  const text = textForItem(item);
  return item.category === "top" && /shirt|polo|knit|quarter zip|cardigan|overshirt|sweater|jumper/.test(text) && !/hoodie|gym|track|sport/.test(text);
}

export function isAvailableClothing(item: WardrobeItem) {
  return item.category !== "body_reference" && !["needs_wash", "drying", "unavailable"].includes(item.laundry_status || "clean");
}

export function isCombinationAllowed(items: WardrobeItem[], context: StyleContext) {
  const formalPieces = items.filter(isSuitOrFormalPiece);
  const veryCasualSport = items.filter(isVeryCasualSportPiece);
  const text = items.map(textForItem).join(" ");
  const hasPinstripeOrSuit = /pinstripe|suit/.test(text);
  const hasHoodieSweatshirt = /hoodie|sweatshirt|burton|track|gym/.test(text);

  if (hasPinstripeOrSuit && hasHoodieSweatshirt) return false;
  if (formalPieces.length >= 2 && veryCasualSport.length >= 1) return false;
  if (!context.allowSuit && formalPieces.length >= 2) return false;
  if (context.mode === "casual_family" && formalPieces.length >= 1 && veryCasualSport.length >= 1) return false;
  if (context.mode === "online_work" && formalPieces.length >= 2) return false;
  return true;
}

export function contextFitScore(item: WardrobeItem, context: StyleContext) {
  const formality = itemFormality(item);
  const text = textForItem(item);
  let score = 50;

  score -= Math.max(0, formality - context.formalityCeiling) * 12;

  if (context.mode === "casual_family") {
    if (/jean|denim|chino|tee|t.?shirt|polo|knit|hoodie|sneaker|vans|casual|rain|jacket/.test(text)) score += 14;
    if (/suit|pinstripe|business|formal|dress shirt|dress shoe|blazer/.test(text)) score -= 32;
  }

  if (context.mode === "online_work") {
    if (isCameraSmartTop(item)) score += 18;
    if (/quarter zip|cardigan|knit|polo|overshirt/.test(text)) score += 12;
    if (/tie|suit|pinstripe|formal trouser|dress shoe/.test(text)) score -= 28;
    if (/hoodie|gym|track|logo|burton/.test(text)) score -= 12;
  }

  if (context.mode === "in_person_work") {
    if (/chino|smart|shirt|polo|knit|cardigan|blazer|loafer|clean sneaker|coat/.test(text)) score += 10;
    if (/full suit|tie|pinstripe/.test(text)) score -= 18;
  }

  if (context.mode === "elevated") {
    if (/smart|chino|dark denim|knit|shirt|polo|loafer|clean sneaker|jacket/.test(text)) score += 12;
    if (/gym|track|worn|hoodie/.test(text)) score -= 12;
  }

  if (/rain|showers|wet|wind|cold|16°|15°|14°|13°/.test((context.reason + " " + text).toLowerCase())) {
    if (/jacket|coat|boot|water|rain|wool|knit/.test(text)) score += 6;
  }

  if ((item.laundry_status || "clean") === "clean") score += 4;
  if (item.fit_status && !/fits|good|ok|tailored/i.test(item.fit_status)) score -= 6;

  return score;
}

export function rankItemsForContext(items: WardrobeItem[], context: StyleContext) {
  return [...items]
    .filter(isAvailableClothing)
    .sort((a, b) => contextFitScore(b, context) - contextFitScore(a, context));
}

export function scoreSwapCandidate(candidate: WardrobeItem, currentOutfit: WardrobeItem[], sourceItem: WardrobeItem, context: StyleContext) {
  const trial = currentOutfit.map((item) => (item.id === sourceItem.id ? candidate : item));
  let score = contextFitScore(candidate, context);
  if (candidate.category === sourceItem.category) score += 18;
  if (candidate.id !== sourceItem.id) score += 10;
  if (!currentOutfit.some((item) => item.id === candidate.id)) score += 8;
  if (!isCombinationAllowed(trial, context)) score -= 90;
  const sourceFormality = itemFormality(sourceItem);
  const candidateFormality = itemFormality(candidate);
  if (candidateFormality <= context.formalityCeiling) score += 10;
  if (context.mode === "online_work" && sourceFormality >= 7 && candidateFormality <= 6) score += 14;
  if (context.mode === "casual_family" && sourceFormality >= 7 && candidateFormality <= 5) score += 18;
  return score;
}

export function swapReason(candidate: WardrobeItem, sourceItem: WardrobeItem, context: StyleContext) {
  const c = textForItem(candidate);
  const sourceFormal = itemFormality(sourceItem);
  const candidateFormal = itemFormality(candidate);
  if (context.mode === "online_work") {
    if (isCameraSmartTop(candidate)) return "Smarter on camera without turning the whole outfit into a suit.";
    if (candidateFormal < sourceFormal) return "Keeps it work-appropriate but less stiff for online meetings.";
  }
  if (context.mode === "casual_family") {
    if (candidateFormal < sourceFormal) return "Lowers the formality for a family/weekend day.";
    if (/sneaker|vans|jean|tee|polo|knit|jacket/.test(c)) return "More relaxed and practical for family time.";
  }
  if (/jacket|coat|knit|wool/.test(c)) return "Adds useful warmth/layering without breaking the outfit.";
  if (/clean sneaker|loafer|boot/.test(c)) return "Fits the formality level and keeps the outfit grounded.";
  return "Best category match for the day’s context and the existing outfit.";
}

export function stylistModeInstruction(context: StyleContext) {
  if (context.mode === "online_work") {
    return "ONLINE WORK MODE: no full suit by default. Prioritise a camera-smart top layer (knit, cardigan, quarter zip, polo, clean overshirt) with comfortable trousers/chinos/jeans and sensible shoes. Avoid tie/full suit unless explicitly requested.";
  }
  if (context.mode === "in_person_work") {
    return "IN-PERSON WORK MODE: use smart separates. A blazer can be used only if it harmonises with the rest of the look. Do not default to a full suit unless the event says formal/client board/dress code.";
  }
  if (context.mode === "casual_family") {
    return "CASUAL FAMILY MODE: relaxed, comfortable, weekend/family appropriate and weather-aware. No corporate styling. Avoid blazers, suits, business shirts, formal trousers and dress shoes unless there is no viable casual alternative.";
  }
  if (context.mode === "elevated") {
    return "ELEVATED CASUAL MODE: creative and intentional, but not corporate. Use texture, colour and smart casual pieces rather than a full suit.";
  }
  if (context.mode === "formal") return "FORMAL MODE: formal clothing is allowed because the user explicitly asked for it.";
  return "PRACTICAL MODE: context-led, personal and weather-aware. Do not default to corporate styling.";
}
