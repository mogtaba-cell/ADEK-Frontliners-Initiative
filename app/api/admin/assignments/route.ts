import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createAssignmentBatch,
  getAssignmentBatch,
  processAutoAssignPending,
} from "@/lib/assignment";
import type { WorkflowPhase } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const repairPhases: WorkflowPhase[] = [
  "coordinator_check",
  "management_review",
  "proofreading",
  "literary_proofreading",
  "final_review",
];

async function readPayload(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return await req.json();
  }

  const form = await req.formData();
  return {
    phase: String(form.get("phase") ?? ""),
    limit: Number(form.get("limit") ?? 5000),
  };
}

export async function GET(req: Request) {
  try {
    await requireUser(["admin"]);

    const { searchParams } = new URL(req.url);
    const batchId = searchParams.get("batchId");

    if (!batchId) {
      return NextResponse.json({ error: "Missing batchId." }, { status: 400 });
    }

    const batch = await getAssignmentBatch(batchId);
    return NextResponse.json(batch);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Could not read assignment batch." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(["admin"]);
    const payload = await readPayload(req);

    const phase = String(payload.phase ?? "");
    const limit = Number.isFinite(Number(payload.limit))
      ? Number(payload.limit)
      : 5000;

    if (!phase) {
      return NextResponse.json({ error: "Missing assignment phase." }, { status: 400 });
    }

    if (phase === "adek_evaluation") {
      return NextResponse.json(
        {
          error:
            "ADEK evaluator assignments are not repaired automatically. Use the evaluator quantity assignment controls instead.",
        },
        { status: 400 }
      );
    }

    if (phase === "repair_missing") {
      const batchId = await createAssignmentBatch("coordinator_check", user.id);

      let eligible = 0;
      let assigned = 0;
      let skipped = 0;
      let errors = 0;

      for (const repairPhase of repairPhases) {
        await processAutoAssignPending(batchId, repairPhase, limit, user.id);
        const batch = await getAssignmentBatch(batchId);

        eligible += Number(batch.eligible_count ?? 0);
        assigned += Number(batch.assigned_count ?? 0);
        skipped += Number(batch.skipped_count ?? 0);
        errors += Number(batch.error_count ?? 0);
      }

      return NextResponse.json({
        batchId,
        status: "completed",
        message: "Repair missing assignments completed.",
        eligible_count: eligible,
        assigned_count: assigned,
        skipped_count: skipped,
        error_count: errors,
      });
    }

    if (!repairPhases.includes(phase as WorkflowPhase)) {
      return NextResponse.json(
        { error: `Unsupported assignment phase: ${phase}` },
        { status: 400 }
      );
    }

    const batchId = await createAssignmentBatch(phase as WorkflowPhase, user.id);
    await processAutoAssignPending(batchId, phase as WorkflowPhase, limit, user.id);

    return NextResponse.json({ batchId });
  } catch (error: any) {
    console.error("Assignment API failed:", error);

    return NextResponse.json(
      { error: error?.message ?? "Assignment failed." },
      { status: 500 }
    );
  }
}
