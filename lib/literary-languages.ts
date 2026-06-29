export const LITERARY_LANGUAGE_OPTIONS = [
  "arabic",
  "english_or_others",
] as const;

export type LiteraryLanguage = (typeof LITERARY_LANGUAGE_OPTIONS)[number];

export const LITERARY_LANGUAGE_DISPLAY_LABELS: Record<LiteraryLanguage, string> = {
  arabic: "Arabic / العربية",
  english_or_others: "English/Others / الإنجليزية أو أخرى",
};

export function isLiteraryLanguage(value: unknown): value is LiteraryLanguage {
  return LITERARY_LANGUAGE_OPTIONS.includes(String(value ?? "") as LiteraryLanguage);
}

export function formatLiteraryLanguageLabel(value: unknown) {
  const language = String(value ?? "").trim();
  if (!language) return "";

  if (isLiteraryLanguage(language)) {
    return LITERARY_LANGUAGE_DISPLAY_LABELS[language];
  }

  return language;
}
