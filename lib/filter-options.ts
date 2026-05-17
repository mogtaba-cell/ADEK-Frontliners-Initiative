import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type FilterOptions = {
  pathways: string[];
  subpathways: string[];
  schoolTypes: string[];
  regions: string[];
  registrationStatuses: string[];
  workflowStatuses: string[];
};

const empty: FilterOptions = {
  pathways: [],
  subpathways: [],
  schoolTypes: [],
  regions: [],
  registrationStatuses: [],
  workflowStatuses: [],
};

function sortUnique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean).map((v) => String(v)))).sort((a, b) => a.localeCompare(b));
}

export async function getSubmissionFilterOptions(): Promise<FilterOptions> {
  const { data, error } = await supabaseAdmin
    .from("analytics_filter_options")
    .select("filter_type,value")
    .order("filter_type", { ascending: true })
    .order("value", { ascending: true });

  if (!error && data) {
    return data.reduce((acc: FilterOptions, row: any) => {
      if (row.filter_type === "pathway") acc.pathways.push(row.value);
      if (row.filter_type === "subpathway") acc.subpathways.push(row.value);
      if (row.filter_type === "school_type") acc.schoolTypes.push(row.value);
      if (row.filter_type === "region") acc.regions.push(row.value);
      if (row.filter_type === "registration_status") acc.registrationStatuses.push(row.value);
      if (row.filter_type === "workflow_status") acc.workflowStatuses.push(row.value);
      return acc;
    }, { ...empty, pathways: [], subpathways: [], schoolTypes: [], regions: [], registrationStatuses: [], workflowStatuses: [] });
  }

  const { data: fallback } = await supabaseAdmin
    .from("submissions")
    .select("art_pathway_name_en,art_sub_pathway_name_en,institution_type,school_region,registration_status,workflow_status")
    .limit(5000);

  return {
    pathways: sortUnique((fallback ?? []).map((s: any) => s.art_pathway_name_en)),
    subpathways: sortUnique((fallback ?? []).map((s: any) => s.art_sub_pathway_name_en)),
    schoolTypes: sortUnique((fallback ?? []).map((s: any) => s.institution_type)),
    regions: sortUnique((fallback ?? []).map((s: any) => s.school_region)),
    registrationStatuses: sortUnique((fallback ?? []).map((s: any) => s.registration_status)),
    workflowStatuses: sortUnique((fallback ?? []).map((s: any) => s.workflow_status)),
  };
}
