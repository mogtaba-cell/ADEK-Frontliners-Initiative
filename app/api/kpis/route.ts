import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KpiResponse = {
  ok: true;
  data: {
    totalSubmissions: number;
    adekEvaluated: number;
    completedAdekEvaluations: number;
    totalSelected: number;
    needsManagementReview: number;
    totalDisqualified: number;
    activeCoordinatorCorrections: number;
    generalProofread: number;
    literaryProofread: number;
    finalReady: number;
    categorized: number;
    artisticRanked: number;
    literarySubcategorized: number;
    finalCompleted: number;
    activeAssignments: number;
    totalClosed: number;
  };
};

const KPI_CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 1000;

let cachedKpis: { expiresAt: number; payload: KpiResponse } | null = null;

type SubmissionSummaryRow = {
  id: string;
  workflow_status?: string | null;
  evaluation_decision?: string | null;
  management_decision?: string | null;
  artistic_rubric_total_score?: number | null;
  artistic_ranking_completed_at?: string | null;
  literary_subcategory_completed_at?: string | null;
};

type AssignmentSummaryRow = {
  submission_id: string | null;
  phase?: string | null;
  proofreader_type?: string | null;
  status?: string | null;
  decision?: string | null;
};

async function fetchAllSubmissions() {
  const rows: SubmissionSummaryRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("submissions")
      .select("id,workflow_status,evaluation_decision,management_decision,artistic_rubric_total_score,artistic_ranking_completed_at,literary_subcategory_completed_at")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("KPI submissions query failed:", error.message);
      return rows;
    }

    rows.push(...((data ?? []) as SubmissionSummaryRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchAllAssignments() {
  const rows: AssignmentSummaryRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("assignments")
      .select("submission_id,phase,proofreader_type,status,decision")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("KPI assignments query failed:", error.message);
      return rows;
    }

    rows.push(...((data ?? []) as AssignmentSummaryRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

function hasAdekFinalityDecision(rows: AssignmentSummaryRow[]) {
  return rows.some((row) => {
    if (row.phase !== "adek_evaluation") return false;

    return (
      (row.status === "completed" && Boolean(row.decision)) ||
      (row.status === "returned_for_correction" && row.decision === "needs_correction")
    );
  });
}

function hasApprovalDecision(rows: AssignmentSummaryRow[], submission: SubmissionSummaryRow) {
  if (submission.evaluation_decision === "approved") return true;
  if (submission.management_decision === "approved") return true;

  return rows.some((row) => {
    if (row.status !== "completed") return false;
    if (row.phase === "adek_evaluation") {
      return row.decision === "approved" || row.decision === "approved_by_management";
    }
    if (row.phase === "management_review") {
      return row.decision === "approved" || row.decision === "approved_by_management";
    }
    return false;
  });
}


async function buildKpis(): Promise<KpiResponse["data"]> {
  const [submissions, assignments] = await Promise.all([
    fetchAllSubmissions(),
    fetchAllAssignments(),
  ]);

  const assignmentsBySubmission = new Map<string, AssignmentSummaryRow[]>();

  for (const assignment of assignments) {
    if (!assignment.submission_id) continue;
    const existing = assignmentsBySubmission.get(assignment.submission_id) ?? [];
    existing.push(assignment);
    assignmentsBySubmission.set(assignment.submission_id, existing);
  }

  let adekEvaluated = 0;
  let totalSelected = 0;
  let needsManagementReview = 0;
  let totalDisqualified = 0;
  let activeCoordinatorCorrections = 0;
  let generalProofread = 0;
  let literaryProofread = 0;
  let finalReady = 0;
  let categorized = 0;
  let artisticRanked = 0;
  let literarySubcategorized = 0;
  let finalCompleted = 0;

  for (const submission of submissions) {
    const rows = assignmentsBySubmission.get(submission.id) ?? [];

    if (hasAdekFinalityDecision(rows)) adekEvaluated += 1;
    if (submission.workflow_status === "needs_management_review") needsManagementReview += 1;
    if (submission.workflow_status === "disqualified") totalDisqualified += 1;

    if (
      submission.workflow_status === "returned_for_correction" &&
      rows.some(
        (row) =>
          row.phase === "coordinator_check" &&
          (row.status === "assigned" || row.status === "in_progress"),
      )
    ) {
      activeCoordinatorCorrections += 1;
    }

    if (
      rows.some(
        (row) =>
          row.phase === "proofreading" &&
          row.proofreader_type === "general" &&
          row.status === "completed" &&
          row.decision === "completed",
      )
    ) {
      generalProofread += 1;
    }

    if (
      rows.some(
        (row) =>
          row.phase === "literary_proofreading" &&
          row.status === "completed" &&
          row.decision === "completed",
      )
    ) {
      literaryProofread += 1;
    }

    if (
      rows.some(
        (row) =>
          row.phase === "final_review" &&
          row.status === "completed" &&
          row.decision === "completed",
      )
    ) {
      finalReady += 1;
    }

    if (
      rows.some(
        (row) =>
          row.phase === "categorization" &&
          row.status === "completed" &&
          row.decision === "completed",
      )
    ) {
      categorized += 1;
    }

    if (
      submission.artistic_rubric_total_score !== null &&
      submission.artistic_rubric_total_score !== undefined &&
      Boolean(submission.artistic_ranking_completed_at)
    ) {
      artisticRanked += 1;
    }

    if (submission.literary_subcategory_completed_at) {
      literarySubcategorized += 1;
    }

    if (submission.workflow_status === "completed") {
      finalCompleted += 1;
    }

    const isInSelectedPipeline =
      submission.workflow_status === "selected_for_proofreading" ||
      submission.workflow_status === "proofreading_done" ||
      submission.workflow_status === "ready_for_categorization" ||
      submission.workflow_status === "ready_for_artistic_ranking" ||
      submission.workflow_status === "ready_for_literary_subcategorization" ||
      submission.workflow_status === "completed";

    // Total Selected only counts submissions still in the selected/final pipeline.
    // If a literary proofreader disqualifies an artwork, workflow_status becomes
    // disqualified, so it is removed from Total Selected and counted under Total Disqualified.
    if (isInSelectedPipeline && hasApprovalDecision(rows, submission)) {
      totalSelected += 1;
    }
  }

  const activeAssignments = assignments.filter(
    (row) => row.status === "assigned" || row.status === "in_progress",
  ).length;

  return {
    totalSubmissions: submissions.length,
    adekEvaluated,
    completedAdekEvaluations: adekEvaluated,
    totalSelected,
    needsManagementReview,
    totalDisqualified,
    activeCoordinatorCorrections,
    generalProofread,
    literaryProofread,
    finalReady,
    categorized,
    artisticRanked,
    literarySubcategorized,
    finalCompleted,
    activeAssignments,
    totalClosed: finalCompleted + totalDisqualified,
  };
}

export async function GET() {
  try {
    const now = Date.now();

    if (cachedKpis && cachedKpis.expiresAt > now) {
      return NextResponse.json(cachedKpis.payload, {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
          "X-KPI-Cache": "hit",
        },
      });
    }

    const payload: KpiResponse = {
      ok: true,
      data: await buildKpis(),
    };

    cachedKpis = {
      expiresAt: now + KPI_CACHE_TTL_MS,
      payload,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
        "X-KPI-Cache": "miss",
      },
    });
  } catch (error: any) {
    console.error("KPI route failed:", error);
    return NextResponse.json(
      { ok: false, error: error.message ?? "Failed to load KPIs.", data: {} },
      { status: 500 },
    );
  }
}
