export const RATER_PATHWAYS = [
  "Visual Expressions",
  "Digital Expressions",
  "Performing Expressions",
  "Others & STEAM Expressions",
  "Literary Expressions",
] as const;

export type RaterPathway = (typeof RATER_PATHWAYS)[number];

export const ARTISTIC_RUBRIC_CRITERIA = [
  {
    id: "artistic_quality_creativity",
    title: "Artistic Quality & Creativity",
    titleAr: "الجودة الفنية والإبداع",
    maxScore: 50,
    description:
      "Technical skill, execution, structure, originality, effective use of artistic elements, attention to detail, audience impact, and student effort.",
  },
  {
    id: "initiative_relation",
    title: "Relation to the Initiative",
    titleAr: "الارتباط بموضوع المبادرة",
    maxScore: 35,
    description:
      "Clear message related to the initiative and innovative use of ideas, symbols, materials, or techniques to deliver the message.",
  },
  {
    id: "age_appropriateness",
    title: "Age Appropriateness",
    titleAr: "الملاءمة العمرية",
    maxScore: 15,
    description:
      "Achievement relative to age or grade level and whether the artistic output is appropriate for the student age group.",
  },
] as const;

export type ArtisticRubricCriterionId = (typeof ARTISTIC_RUBRIC_CRITERIA)[number]["id"];

export function normalizeRaterPathway(value: unknown) {
  const text = String(value ?? "").trim();
  return RATER_PATHWAYS.find((pathway) => pathway === text) ?? null;
}

export function calculateArtisticRubricTotal(scores: {
  artisticQualityCreativity: number;
  initiativeRelation: number;
  ageAppropriateness: number;
}) {
  return (
    scores.artisticQualityCreativity +
    scores.initiativeRelation +
    scores.ageAppropriateness
  );
}

export function finalArtisticRatingFromScore(totalScore: number) {
  if (totalScore >= 99 && totalScore <= 100) return "Outstanding";
  if (totalScore >= 90 && totalScore <= 98) return "Excellent";
  if (totalScore >= 75 && totalScore <= 89) return "Very Good";
  // The supplied rubric document lists Average as 41-65 and does not assign
  // a label to 66-74. Treat 41-74 as Average so every valid score maps to a
  // final platform rating while preserving the published higher bands.
  if (totalScore >= 41 && totalScore <= 74) return "Average";
  return "Weak";
}

export function parseRubricScore(value: unknown, maxScore: number, label: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue)) {
    throw new Error(`${label} must be a whole number.`);
  }

  if (numberValue < 0 || numberValue > maxScore) {
    throw new Error(`${label} must be between 0 and ${maxScore}.`);
  }

  return numberValue;
}
