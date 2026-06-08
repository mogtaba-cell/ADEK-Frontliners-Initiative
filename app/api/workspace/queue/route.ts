import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { WorkflowPhase } from "@/lib/types";

const WORKSPACE_PAGE_SIZE = 50;

const allAssignmentStatuses = [
  "assigned",
  "in_progress",
  "completed",
  "returned_for_correction",
  "sent_for_review",
];

const validWorkspacePhases = new Set([
  "adek_evaluation",
  "coordinator_check",
  "management_review",
  "proofreading",
  "literary_proofreading",
  "final_review",
]);

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function getPositiveIntegerParam(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function statusesForView(phase: WorkflowPhase, view: string) {
  if (view === "all") return allAssignmentStatuses;
  if (view === "completed") return ["completed"];

  if (view === "approved" || view === "disqualified") {
    return ["completed"];
  }

  if (view === "needs_review") {
    return phase === "management_review" ? ["assigned"] : ["completed"];
  }

  if (view === "pending") {
    return phase === "management_review"
      ? ["in_progress"]
      : ["assigned", "in_progress"];
  }

  if (view === "sent_for_review") return ["sent_for_review"];
  if (view === "waiting_for_response") return ["assigned", "in_progress"];

  if (view === "sent_for_correction" || view === "returned_for_correction") {
    return ["returned_for_correction"];
  }

  return ["assigned", "in_progress"];
}

function defaultViewForPhase(phase: WorkflowPhase) {
  if (phase === "management_review") return "needs_review";
  return "not_completed";
}

function applyDecisionGate(query: any, phase: WorkflowPhase, view: string) {
  if (view === "approved") return query.eq("decision", "approved");
  if (view === "disqualified") return query.eq("decision", "disqualified");

  if (phase === "management_review") {
    if (view === "needs_review") return query.is("decision", null);
    if (view === "pending") return query.eq("decision", "pending");
  }

  if (view === "needs_review") {
    return query.eq("decision", "needs_review");
  }

  return query;
}

function applySourceGate(query: any, correctionSourcePhase?: string) {
  if (!correctionSourcePhase) return query;
  return query.eq("correction_source_phase", correctionSourcePhase);
}

function applyCoordinatorWaitingGate(
  query: any,
  phase: WorkflowPhase,
  view: string,
) {
  if (phase === "coordinator_check" && view === "waiting_for_response") {
    return query.eq("coordinator_waiting_for_response", true);
  }

  return query;
}

function applyProofreaderTypeGate(
  query: any,
  phase: WorkflowPhase,
  proofreaderType?: string | null,
) {
  if (!proofreaderType) return query;

  if (phase === "proofreading" || phase === "literary_proofreading") {
    return query.eq("proofreader_type", proofreaderType);
  }

  return query;
}

function applySchoolGate(query: any, schoolValue: string) {
  if (!schoolValue) return query;

  if (schoolValue === "unknown") {
    return query
      .is("submissions.institution_name", null)
      .is("submissions.institution_ref_number", null);
  }

  if (schoolValue.startsWith("ref:")) {
    return query.eq("submissions.institution_ref_number", schoolValue.slice(4));
  }

  if (schoolValue.startsWith("name:")) {
    return query.eq("submissions.institution_name", schoolValue.slice(5));
  }

  return query.ilike("submissions.institution_name", `%${schoolValue}%`);
}

function buildAssignmentRowsQuery({
  userId,
  phase,
  view,
  statuses,
  correctionSourcePhase,
  proofreaderType,
  correctionReason,
  pathway,
  school,
  search,
  from,
  to,
}: {
  userId: string;
  phase: WorkflowPhase;
  view: string;
  statuses: string[];
  correctionSourcePhase?: string;
  proofreaderType?: string | null;
  correctionReason?: string;
  pathway?: string;
  school?: string;
  search?: string;
  from: number;
  to: number;
}) {
  let query = supabaseAdmin
    .from("assignments")
    .select(
      `
      id,
      phase,
      status,
      decision,
      created_at,
      started_at,
      completed_at,
      submission_id,
      requested_by_user_id,
      return_to_user_id,
      correction_reason,
      correction_notes,
      correction_source_phase,
      correction_source_assignment_id,
      proofreader_type,
      coordinator_comment,
      coordinator_waiting_for_response,
      coordinator_waiting_for_response_at,
      submissions!inner(
        id,
        reference_id,
        registration_id,
        registration_status,
        workflow_status,
        institution_name,
        institution_ref_number,
        institution_type,
        school_region,
        group_name,
        art_pathway_name_en,
        art_pathway_name_ar,
        art_sub_pathway_name_en,
        art_sub_pathway_name_ar,
        artwork_title_en,
        artwork_title_ar,
        description_en,
        description_ar,
        influence_idea_source,
        most_enjoyable_part,
        focused_elements,
        participating_students_names,
        participating_students_esis_numbers,
        participating_students_genders,
        participating_students_grades,
        participating_students_nationalities,
        art_link,
        updated_artwork_file_name,
        updated_artwork_file_url,
        submission_date,
        submission_date_value,
        artistic_rating,
        management_artistic_rating,
        evaluator_comment,
        evaluator_file_quality_clear,
        literary_publication_suitable,
        literary_proofreader_comment,
        literary_updated_content,
        raw_data
      )
      `,
    )
    .eq("assigned_to", userId)
    .eq("phase", phase)
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .range(from, to);

  query = applyDecisionGate(query, phase, view);
  query = applySourceGate(query, correctionSourcePhase);
  query = applyCoordinatorWaitingGate(query, phase, view);
  query = applyProofreaderTypeGate(query, phase, proofreaderType);

  if (correctionReason) {
    query = query.eq("correction_reason", correctionReason);
  }

  if (pathway) {
    query = query.eq("submissions.art_pathway_name_en", pathway);
  }

  if (school) {
    query = applySchoolGate(query, school);
  }

  if (search && search.trim().length >= 2) {
    const q = search.trim().replaceAll("%", "");

    query = query.or(
      `reference_id.ilike.%${q}%,institution_name.ilike.%${q}%,artwork_title_en.ilike.%${q}%,artwork_title_ar.ilike.%${q}%`,
      { foreignTable: "submissions" },
    );
  }

  return query;
}

async function fetchAssignmentRowsPage({
  userId,
  phase,
  view,
  correctionSourcePhase,
  proofreaderType,
  correctionReason,
  pathway,
  school,
  search,
  page,
}: {
  userId: string;
  phase: WorkflowPhase;
  view: string;
  correctionSourcePhase?: string;
  proofreaderType?: string | null;
  correctionReason?: string;
  pathway?: string;
  school?: string;
  search?: string;
  page: number;
}) {
  const statuses = statusesForView(phase, view);
  const from = (Math.max(1, page) - 1) * WORKSPACE_PAGE_SIZE;
  const to = from + WORKSPACE_PAGE_SIZE;

  const { data, error } = await buildAssignmentRowsQuery({
    userId,
    phase,
    view,
    statuses,
    correctionSourcePhase,
    proofreaderType,
    correctionReason,
    pathway,
    school,
    search,
    from,
    to,
  });

  if (error) throw error;

  const rows = data ?? [];
  const hasNextPage = rows.length > WORKSPACE_PAGE_SIZE;

  return {
    rows: hasNextPage ? rows.slice(0, WORKSPACE_PAGE_SIZE) : rows,
    hasNextPage,
  };
}

async function enrichWithTaskHistory(assignments: any[]) {
  const submissionIds = Array.from(
    new Set(assignments.map((row: any) => row.submission_id).filter(Boolean)),
  );

  const historyBySubmission: Record<string, any[]> = {};

  if (!submissionIds.length) return assignments;

  const historyRows: any[] = [];

  for (const submissionIdChunk of chunkArray(submissionIds, 200)) {
    const { data: chunkHistoryRows, error: historyError } = await supabaseAdmin
      .from("assignments")
      .select(
        "id,submission_id,phase,status,decision,assigned_to,requested_by_user_id,return_to_user_id,correction_reason,correction_source_phase,created_at,completed_at,proofreader_type",
      )
      .in("submission_id", submissionIdChunk)
      .order("created_at", { ascending: true });

    if (historyError) {
      console.error("Workspace API history query failed:", historyError.message);
      continue;
    }

    historyRows.push(...(chunkHistoryRows ?? []));
  }

  const profileIds = Array.from(
    new Set(
      historyRows
        .flatMap((row: any) => [
          row.assigned_to,
          row.requested_by_user_id,
          row.return_to_user_id,
        ])
        .filter(Boolean),
    ),
  );

  const profileById: Record<string, any> = {};

  for (const profileIdChunk of chunkArray(profileIds, 200)) {
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id,full_name,role,proofreader_type")
      .in("id", profileIdChunk);

    if (profileError) {
      console.error("Workspace API profile query failed:", profileError.message);
      continue;
    }

    for (const profile of profiles ?? []) {
      profileById[profile.id] = profile;
    }
  }

  for (const row of historyRows) {
    const enriched = {
      ...row,
      assigned_user: profileById[row.assigned_to] ?? null,
      requested_by_user: profileById[row.requested_by_user_id] ?? null,
      return_to_user: profileById[row.return_to_user_id] ?? null,
    };

    if (!historyBySubmission[row.submission_id]) {
      historyBySubmission[row.submission_id] = [];
    }

    historyBySubmission[row.submission_id].push(enriched);
  }

  return assignments.map((assignment: any) => ({
    ...assignment,
    task_history: historyBySubmission[assignment.submission_id] ?? [],
  }));
}

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawPhase = searchParams.get("phase") || "";

  if (!validWorkspacePhases.has(rawPhase)) {
    return NextResponse.json({ error: "Invalid workspace phase" }, { status: 400 });
  }

  const phase = rawPhase as WorkflowPhase;
  const view = searchParams.get("view") || defaultViewForPhase(phase);
  const page = getPositiveIntegerParam(searchParams.get("page"), 1);

  const { rows, hasNextPage } = await fetchAssignmentRowsPage({
    userId: user.id,
    phase,
    view,
    correctionSourcePhase: searchParams.get("correction_source_phase") || "",
    proofreaderType: user.proofreader_type ?? null,
    correctionReason: searchParams.get("correction_reason") || "",
    pathway: searchParams.get("pathway") || "",
    school: phase === "coordinator_check" ? searchParams.get("school") || "" : "",
    search: searchParams.get("search") || "",
    page,
  });

  const assignments = await enrichWithTaskHistory(rows);

  return NextResponse.json({
    assignments,
    hasNextPage,
    page,
    pageSize: WORKSPACE_PAGE_SIZE,
  });
}
