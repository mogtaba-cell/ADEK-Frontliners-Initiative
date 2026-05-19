import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Filter = {
  column: string;
  operator?: "eq" | "in" | "not.is";
  value: any;
};

async function countRows({
  table,
  filters = [],
}: {
  table: string;
  filters?: Filter[];
}) {
  let query = supabaseAdmin.from(table).select("id", {
    count: "exact",
    head: true,
  });

  for (const filter of filters) {
    if (filter.operator === "in") {
      query = query.in(filter.column, filter.value);
    } else if (filter.operator === "not.is") {
      query = query.not(filter.column, "is", filter.value);
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

async function countDistinctRows({
  table,
  column,
  filters = [],
}: {
  table: string;
  column: string;
  filters?: Filter[];
}) {
  let query = supabaseAdmin.from(table).select(column);

  for (const filter of filters) {
    if (filter.operator === "in") {
      query = query.in(filter.column, filter.value);
    } else if (filter.operator === "not.is") {
      query = query.not(filter.column, "is", filter.value);
    } else {
      query = query.eq(filter.column, filter.value);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error(`KPI distinct count failed for ${table}.${column}:`, error.message);
    return 0;
  }

  return new Set((data ?? []).map((row: any) => row[column]).filter(Boolean)).size;
}

export async function GET() {
  try {
    const selectedWorkflowStatuses = [
      "selected_for_proofreading",
      "proofreading_in_progress",
      "proofreading_done",
      "final_review_in_progress",
      "completed",
    ];

    const [
      totalSubmissions,
      totalEvaluated,
      totalSelected,
      totalProofread,
      totalReviewed,
      totalReady,
    ] = await Promise.all([
      countRows({ table: "submissions" }),

      // The current workflow stores ADEK results on submissions and completes
      // ADEK assignments. The old evaluations table may be empty, so count live
      // completed ADEK assignment submissions instead.
      countDistinctRows({
        table: "assignments",
        column: "submission_id",
        filters: [
          { column: "phase", value: "adek_evaluation" },
          { column: "status", value: "completed" },
        ],
      }),

      countRows({
        table: "submissions",
        filters: [
          {
            column: "workflow_status",
            operator: "in",
            value: selectedWorkflowStatuses,
          },
        ],
      }),

      countDistinctRows({
        table: "assignments",
        column: "submission_id",
        filters: [
          {
            column: "phase",
            operator: "in",
            value: ["proofreading", "literary_proofreading"],
          },
          { column: "status", value: "completed" },
        ],
      }),

      countDistinctRows({
        table: "assignments",
        column: "submission_id",
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
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
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
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  }
}
