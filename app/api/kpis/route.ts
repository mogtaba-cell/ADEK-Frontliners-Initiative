import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const evaluatedStatuses = [
  "needs_management_review",
  "selected_for_proofreading",
  "proofreading_done",
  "completed",
  "disqualified",
];

const selectedStatuses = [
  "selected_for_proofreading",
  "proofreading_done",
  "completed",
];

const proofreadStatuses = ["proofreading_done", "completed"];

const reviewedStatuses = ["completed"];

const readyStatuses = ["completed"];

async function countSubmissionsByStatuses(statuses: string[]) {
  const { count, error } = await supabaseAdmin
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .in("workflow_status", statuses);

  if (error) {
    console.error("KPI count error:", error.message);
    return 0;
  }

  return count ?? 0;
}

export async function GET() {
  try {
    await requireUser([
      "admin",
      "management",
      "coordinator",
      "evaluator",
      "proofreader",
      "reviewer",
      "adek_hq",
    ]);

    const [
      total,
      evaluatedByStatus,
      evaluationsCount,
      selected,
      proofread,
      reviewed,
      ready,
    ] = await Promise.all([
      supabaseAdmin
        .from("submissions")
        .select("id", { count: "exact", head: true }),

      countSubmissionsByStatuses(evaluatedStatuses),

      supabaseAdmin
        .from("evaluations")
        .select("id", { count: "exact", head: true }),

      countSubmissionsByStatuses(selectedStatuses),
      countSubmissionsByStatuses(proofreadStatuses),
      countSubmissionsByStatuses(reviewedStatuses),
      countSubmissionsByStatuses(readyStatuses),
    ]);

    return NextResponse.json(
      {
        total: total.count ?? 0,
        evaluated: Math.max(evaluatedByStatus, evaluationsCount.count ?? 0),
        selected,
        proofread,
        reviewed,
        ready,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load KPIs." },
      { status: error.message === "FORBIDDEN" ? 403 : 500 }
    );
  }
}