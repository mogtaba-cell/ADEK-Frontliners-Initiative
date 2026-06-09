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
    adekRemaining: number;
    actionableAdekRemaining: number;
    heldUnassignedAdek: number;
    totalSelected: number;
    needsManagementReview: number;
    totalDisqualified: number;
    activeCoordinatorCorrections: number;
    generalProofread: number;
    literaryProofread: number;
    finalReady: number;
    activeAssignments: number;
  };
};

const KPI_CACHE_TTL_MS = 60_000;
let cachedKpis: { expiresAt: number; payload: KpiResponse } | null = null;

const PAGE_SIZE = 1000;

type AssignmentSummaryRow = {
  submission_id: string | null;
  phase?: string | null;
  status?: string | null;
  decision?: string | null;
};

async function countRows(table: string, filters?: (query: any) => any) {
  let query = supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  if (filters) query = filters(query);
  const { count, error } = await query;
  if (error) {
    console.error(`KPI count failed for ${table}:`, error.message);
    return 0;
  }
  return count ?? 0;
}

async function countAssignments(filters: (query: any) => any) {
  let query = supabaseAdmin.from("assignments").select("submission_id", { count: "exact", head: true });
  query = filters(query);
  const { count, error } = await query;
  if (error) {
    console.error("KPI assignment count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function fetchAssignmentSummaries(filters?: (query: any) => any) {
  const rows: AssignmentSummaryRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabaseAdmin
      .from("assignments")
      .select("submission_id,phase,status,decision")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (filters) query = filters(query);

    const { data, error } = await query;

    if (error) {
      console.error("KPI assignment summary query failed:", error.message);
      return rows;
    }

    rows.push(...((data ?? []) as AssignmentSummaryRow[]));

    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchSubmissionIds(filters?: (query: any) => any) {
  const ids = new Set<string>();

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabaseAdmin
      .from("submissions")
      .select("id")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (filters) query = filters(query);

    const { data, error } = await query;

    if (error) {
      console.error("KPI submission id query failed:", error.message);
      return ids;
    }

    for (const row of data ?? []) {
      if (row.id) ids.add(row.id);
    }

    if (!data || data.length < PAGE_SIZE) break;
  }

  return ids;
}

function isFinalityAdekDecision(row: AssignmentSummaryRow) {
  const status = row.status ?? "";
  const decision = row.decision ?? "";

  return (
    (status === "completed" && Boolean(decision)) ||
    (status === "returned_for_correction" && decision === "needs_correction")
  );
}

async function getAdekFinalityCounts() {
  const [readyForAdekIds, adekAssignments] = await Promise.all([
    fetchSubmissionIds((query) => query.eq("workflow_status", "ready_for_adek")),
    fetchAssignmentSummaries((query) => query.eq("phase", "adek_evaluation")),
  ]);

  const adekEvaluatedIds = new Set<string>();
  const activeReadyAdekIds = new Set<string>();

  for (const row of adekAssignments) {
    if (!row.submission_id) continue;

    if (isFinalityAdekDecision(row)) {
      adekEvaluatedIds.add(row.submission_id);
    }

    if (
      readyForAdekIds.has(row.submission_id) &&
      (row.status === "assigned" || row.status === "in_progress")
    ) {
      activeReadyAdekIds.add(row.submission_id);
    }
  }

  let heldUnassignedAdek = 0;

  for (const submissionId of readyForAdekIds) {
    if (!activeReadyAdekIds.has(submissionId) && !adekEvaluatedIds.has(submissionId)) {
      heldUnassignedAdek += 1;
    }
  }

  return {
    adekEvaluated: adekEvaluatedIds.size,
    actionableAdekRemaining: activeReadyAdekIds.size,
    heldUnassignedAdek,
    adekRemaining: activeReadyAdekIds.size + heldUnassignedAdek,
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

    const [
      totalSubmissions,
      adekFinalityCounts,
      totalSelected,
      needsManagementReview,
      totalDisqualified,
      activeCoordinatorCorrections,
      generalProofread,
      literaryProofread,
      finalReady,
      activeAssignments,
    ] = await Promise.all([
      countRows("submissions"),
      getAdekFinalityCounts(),
      countRows("submissions", (query) => query.eq("evaluation_decision", "approved").neq("workflow_status", "disqualified")),
      countAssignments((query) => query.eq("phase", "management_review").in("status", ["assigned", "in_progress"])),
      countRows("submissions", (query) => query.or("workflow_status.eq.disqualified,evaluation_decision.eq.disqualified,management_decision.eq.disqualified")),
      countAssignments((query) => query.eq("phase", "coordinator_check").in("status", ["assigned", "in_progress"])),
      countAssignments((query) => query.eq("phase", "proofreading").eq("status", "completed").not("completed_at", "is", null)),
      countAssignments((query) => query.eq("phase", "literary_proofreading").eq("status", "completed").not("completed_at", "is", null)),
      countAssignments((query) => query.eq("phase", "final_review").eq("status", "completed").not("completed_at", "is", null)),
      countAssignments((query) => query.in("status", ["assigned", "in_progress"])),
    ]);

    const payload: KpiResponse = {
      ok: true,
      data: {
        totalSubmissions,
        adekEvaluated: adekFinalityCounts.adekEvaluated,
        completedAdekEvaluations: adekFinalityCounts.adekEvaluated,
        adekRemaining: adekFinalityCounts.adekRemaining,
        actionableAdekRemaining: adekFinalityCounts.actionableAdekRemaining,
        heldUnassignedAdek: adekFinalityCounts.heldUnassignedAdek,
        totalSelected,
        needsManagementReview,
        totalDisqualified,
        activeCoordinatorCorrections,
        generalProofread,
        literaryProofread,
        finalReady,
        activeAssignments,
      },
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
      { status: 500 }
    );
  }
}
