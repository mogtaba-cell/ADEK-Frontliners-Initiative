import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Filters = {
  pathway?: string;
  subpathway?: string;
  region?: string;
  schoolType?: string;
  registrationStatus?: string;
  workflowStatus?: string;
  artisticRating?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

export function hasSubmissionFilters(filters: Filters) {
  return Boolean(filters.pathway || filters.subpathway || filters.region || filters.schoolType || filters.registrationStatus || filters.workflowStatus || filters.artisticRating || filters.dateFrom || filters.dateTo || filters.search);
}

export function applySubmissionFilters(query: any, filters: Filters) {
  if (filters.pathway) query = query.eq("art_pathway_name_en", filters.pathway);
  if (filters.subpathway) query = query.eq("art_sub_pathway_name_en", filters.subpathway);
  if (filters.region) query = query.eq("school_region", filters.region);
  if (filters.schoolType) query = query.eq("institution_type", filters.schoolType);
  if (filters.registrationStatus) query = query.eq("registration_status", filters.registrationStatus);
  if (filters.workflowStatus) query = query.eq("workflow_status", filters.workflowStatus);
  if (filters.artisticRating) query = query.eq("artistic_rating", filters.artisticRating);
  if (filters.dateFrom) query = query.gte("submission_date_value", filters.dateFrom);
  if (filters.dateTo) query = query.lte("submission_date_value", filters.dateTo);
  if (filters.search && filters.search.trim().length >= 2) {
    const q = filters.search.trim().replaceAll("%", "");
    query = query.or(`reference_id.ilike.%${q}%,institution_name.ilike.%${q}%,artwork_title_en.ilike.%${q}%,artwork_title_ar.ilike.%${q}%`);
  }
  return query;
}

export async function getFilteredSubmissionIds(filters: Filters, limit = 10000) {
  if (!hasSubmissionFilters(filters)) return null;

  let query = supabaseAdmin.from("submissions").select("id").limit(limit);
  query = applySubmissionFilters(query, filters);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row: any) => row.id as string);
}