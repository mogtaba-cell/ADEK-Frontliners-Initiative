import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type FilterOptions = {
  pathways: string[];
  subpathways: string[];
  schoolTypes: string[];
  regions: string[];
  registrationStatuses: string[];
  workflowStatuses: string[];
  artisticRatings: string[];
};

const empty: FilterOptions = {
  pathways: [],
  subpathways: [],
  schoolTypes: [],
  regions: [],
  registrationStatuses: [],
  workflowStatuses: [],
  artisticRatings: [],
};

const PAGE_SIZE = 1000;
const FILTER_OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedFilterOptions: { expiresAt: number; value: FilterOptions } | null = null;

const OFFICIAL_ARTISTIC_RATINGS = ["excellent", "good", "medium", "weak"];

function sortUnique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .filter((value) => value !== null && value !== undefined)
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeArtisticRatingValue(value: unknown) {
  const cleaned = String(value ?? "").trim().toLowerCase();

  if (cleaned === "excellent" || cleaned === "ممتاز") return "excellent";
  if (cleaned === "good" || cleaned === "جيد") return "good";
  if (cleaned === "medium" || cleaned === "متوسط") return "medium";
  if (cleaned === "weak" || cleaned === "ضعيف") return "weak";

  return cleaned;
}

function artisticRatingSortRank(value: string) {
  if (value === "excellent") return 1;
  if (value === "good") return 2;
  if (value === "medium") return 3;
  if (value === "weak") return 4;
  return 99;
}

function sortArtisticRatings(values: string[]) {
  return values.sort((a, b) => {
    const ar = artisticRatingSortRank(a);
    const br = artisticRatingSortRank(b);

    if (ar !== br) return ar - br;

    return a.localeCompare(b);
  });
}

async function fetchAllSubmissionFilterRows() {
  const rows: any[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabaseAdmin
      .from("submissions")
      .select(
        [
          "art_pathway_name_en",
          "art_sub_pathway_name_en",
          "institution_type",
          "school_region",
          "registration_status",
          "workflow_status",
          "artistic_rating",
        ].join(",")
      )
      .range(from, to);

    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

export async function getSubmissionFilterOptions(): Promise<FilterOptions> {
  const now = Date.now();

  if (cachedFilterOptions && cachedFilterOptions.expiresAt > now) {
    return cachedFilterOptions.value;
  }

  const rows = await fetchAllSubmissionFilterRows();

  const liveArtisticRatings = sortUnique(
    rows
      .map((submission: any) => submission.artistic_rating)
      .map(normalizeArtisticRatingValue)
      .filter(Boolean)
  );

  const artisticRatings = sortArtisticRatings(
    sortUnique([
      ...OFFICIAL_ARTISTIC_RATINGS,
      ...liveArtisticRatings,
    ])
  );

  let analyticsOptions: any[] = [];

  const { data, error } = await supabaseAdmin
    .from("analytics_filter_options")
    .select("filter_type,value")
    .order("filter_type", { ascending: true })
    .order("value", { ascending: true });

  if (!error && data) {
    analyticsOptions = data;
  }

  if (analyticsOptions.length > 0) {
    const options = analyticsOptions.reduce(
      (acc: FilterOptions, row: any) => {
        if (row.filter_type === "pathway") acc.pathways.push(row.value);
        if (row.filter_type === "subpathway") acc.subpathways.push(row.value);
        if (row.filter_type === "school_type") acc.schoolTypes.push(row.value);
        if (row.filter_type === "region") acc.regions.push(row.value);

        if (row.filter_type === "registration_status") {
          acc.registrationStatuses.push(row.value);
        }

        if (row.filter_type === "workflow_status") {
          acc.workflowStatuses.push(row.value);
        }

        return acc;
      },
      {
        ...empty,
        pathways: [],
        subpathways: [],
        schoolTypes: [],
        regions: [],
        registrationStatuses: [],
        workflowStatuses: [],
        artisticRatings,
      }
    );

    const value = {
      pathways: sortUnique(options.pathways),
      subpathways: sortUnique(options.subpathways),
      schoolTypes: sortUnique(options.schoolTypes),
      regions: sortUnique(options.regions),
      registrationStatuses: sortUnique(options.registrationStatuses),
      workflowStatuses: sortUnique(options.workflowStatuses),
      artisticRatings,
    };

    cachedFilterOptions = { expiresAt: now + FILTER_OPTIONS_CACHE_TTL_MS, value };

    return value;
  }

  const value = {
    pathways: sortUnique(
      rows.map((submission: any) => submission.art_pathway_name_en)
    ),
    subpathways: sortUnique(
      rows.map((submission: any) => submission.art_sub_pathway_name_en)
    ),
    schoolTypes: sortUnique(
      rows.map((submission: any) => submission.institution_type)
    ),
    regions: sortUnique(
      rows.map((submission: any) => submission.school_region)
    ),
    registrationStatuses: sortUnique(
      rows.map((submission: any) => submission.registration_status)
    ),
    workflowStatuses: sortUnique(
      rows.map((submission: any) => submission.workflow_status)
    ),
    artisticRatings,
  };

  cachedFilterOptions = { expiresAt: now + FILTER_OPTIONS_CACHE_TTL_MS, value };

  return value;
}