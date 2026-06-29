export const LITERARY_SUBCATEGORY_OPTIONS = [
  "Letters & Messages",
  "Poetry (Written or Recited)",
  "Speech",
  "Short Story",
  "Other Creative Writing",
] as const;

export type LiterarySubcategory = (typeof LITERARY_SUBCATEGORY_OPTIONS)[number];

export function isLiterarySubcategory(value: unknown): value is LiterarySubcategory {
  return LITERARY_SUBCATEGORY_OPTIONS.includes(String(value ?? "") as LiterarySubcategory);
}
