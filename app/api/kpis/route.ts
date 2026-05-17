import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function countRows({
  table,
  filters = [],
}: {
  table: string;
  filters?: {
    column: string;
    operator?: "eq" | "in";
    value: any;
  }[];
}) {
  let query = supabaseAdmin.from(table).select("id", {
    count: "exact",
    head: true,
  });

  for (const filter of filters) {
    if (filter.operator === "in") {
      query = query.in(filter.column, filter.value);
    } else {
      query = query.eq(filter.column, filter.value);
    }
  }

  const { count, error } = await query;

  if (error) {
    console.error(`KPI count failed for ${table}:`, error.message);
    return 0;
  }

  return count ?? 0;
}

async function countDistinctEvaluatedSubmissions() {
  const { data, error } = await supabaseAdmin
    .from("evaluations")
    .select("submission_id");

  if (error) {
    console.error("KPI evaluated submissions failed:", error.message);
    return 0;
  }

  return new Set((data ?? []).map((row) => row.submission_id).filter(Boolean))
    .size;
}

export async function GET() {
  try {
    const [
      totalSubmissions,
      totalEvaluated,
      totalSelected,
      totalProofread,
      totalReviewed,
      totalReady,
    ] = await Promise.all([
      countRows({
        table: "submissions",
      }),

      countDistinctEvaluatedSubmissions(),

      countRows({
        table: "submissions",
        filters: [
          {
            column: "workflow_status",
            operator: "in",
            value: [
              "selected_for_proofreading",
              "proofreading_done",
              "ready_for_review",
              "under_review",
              "completed",
            ],
          },
        ],
      }),

      countRows({
        table: "assignments",
        filters: [
          { column: "phase", value: "proofreading" },
          { column: "status", value: "completed" },
        ],
      }),

      countRows({
        table: "assignments",
        filters: [
          { column: "phase", value: "final_review" },
          { column: "status", value: "completed" },
        ],
      }),

      countRows({
        table: "submissions",
        filters: [{ column: "workflow_status", value: "completed" }],
      }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        data: {
          totalSubmissions,
          totalEvaluated,
          totalSelected,
          totalProofread,
          totalReviewed,
          totalReady,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    console.error("KPI route failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error.message ?? "Failed to load KPIs.",
        data: {
          totalSubmissions: 0,
          totalEvaluated: 0,
          totalSelected: 0,
          totalProofread: 0,
          totalReviewed: 0,
          totalReady: 0,
        },
      },
      { status: 500 }
    );
  }
}