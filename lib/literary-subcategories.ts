export const LITERARY_SUBCATEGORY_OPTIONS = [
  "Letters & Messages",
  "Poetry (Written or Recited)",
  "Speech",
  "Short Story",
  "Other Creative Writing",
] as const;

export type LiterarySubcategory = (typeof LITERARY_SUBCATEGORY_OPTIONS)[number];

export const LITERARY_SUBCATEGORY_ARABIC_LABELS: Record<
  LiterarySubcategory,
  string
> = {
  "Letters & Messages": "رسائل ومخاطبات",
  "Poetry (Written or Recited)": "شعر (كتابةً أو إلقاءً)",
  Speech: "خطابة",
  "Short Story": "قصة قصيرة",
  "Other Creative Writing": "تعبير إبداعي حر",
};

export const LITERARY_SUBCATEGORY_DISPLAY_LABELS: Record<
  LiterarySubcategory,
  string
> = Object.fromEntries(
  LITERARY_SUBCATEGORY_OPTIONS.map((subcategory) => [
    subcategory,
    `${subcategory} / ${LITERARY_SUBCATEGORY_ARABIC_LABELS[subcategory]}`,
  ])
) as Record<LiterarySubcategory, string>;

export function isLiterarySubcategory(value: unknown): value is LiterarySubcategory {
  return LITERARY_SUBCATEGORY_OPTIONS.includes(String(value ?? "") as LiterarySubcategory);
}

export function formatLiterarySubcategoryLabel(value: unknown) {
  const subcategory = String(value ?? "").trim();
  if (!subcategory) return "";

  if (isLiterarySubcategory(subcategory)) {
    return LITERARY_SUBCATEGORY_DISPLAY_LABELS[subcategory];
  }

  return subcategory;
}
