import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KpiResponse = {
  ok: true;
  data: {
    totalSubmissions: number;
    completedAdekEvaluations: number;
    totalSelected: number;
    needsManagementReview: number;
    totalDisqualified: number;
    activeCoordinatorCorrections: number;
    generalProofread: number;
    literaryProofread: number;
    finalReady: number;
    totalClosed: number;
  };
};

const KPI_CACHE_TTL_MS = 60_000;
let cachedKpis: { expiresAt: number; payload: KpiResponse } | null = null;

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
      completedAdekEvaluations,
      totalSelected,
      needsManagementReview,
      totalDisqualified,
      activeCoordinatorCorrections,
      generalProofread,
      literaryProofread,
      finalReady,
    ] = await Promise.all([
      countRows("submissions"),
      countAssignments((query) => query.eq("phase", "adek_evaluation").eq("status", "completed").not("completed_at", "is", null)),
      countRows("submissions", (query) => query.eq("evaluation_decision", "approved").neq("workflow_status", "disqualified")),
      countAssignments((query) => query.eq("phase", "management_review").in("status", ["assigned", "in_progress"])),
      countRows("submissions", (query) => query.or("workflow_status.eq.disqualified,evaluation_decision.eq.disqualified,management_decision.eq.disqualified")),
      countAssignments((query) => query.eq("phase", "coordinator_check").in("status", ["assigned", "in_progress"])),
      countAssignments((query) => query.eq("phase", "proofreading").eq("status", "completed").not("completed_at", "is", null)),
      countAssignments((query) => query.eq("phase", "literary_proofreading").eq("status", "completed").not("completed_at", "is", null)),
      countAssignments((query) => query.eq("phase", "final_review").eq("status", "completed").not("completed_at", "is", null)),
    ]);

    const totalClosed = finalReady + totalDisqualified;

    const payload: KpiResponse = {
      ok: true,
      data: {
        totalSubmissions,
        completedAdekEvaluations,
        totalSelected,
        needsManagementReview,
        totalDisqualified,
        activeCoordinatorCorrections,
        generalProofread,
        literaryProofread,
        finalReady,
        totalClosed,
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
