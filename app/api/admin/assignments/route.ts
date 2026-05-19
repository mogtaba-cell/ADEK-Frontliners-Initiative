import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createAssignmentBatch,
  getAssignmentBatch,
  processAutoAssignPending,
} from "@/lib/assignment";
import type { WorkflowPhase } from "@/lib/types";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const allowedPhases: WorkflowPhase[] = [
  "coordinator_check",
  "adek_evaluation",
  "management_review",
  "proofreading",
  "literary_proofreading",
  "final_review",
];

export async function GET(req: Request) {
  try {
    await requireUser(["admin"]);

    const url = new URL(req.url);
    const batchId = url.searchParams.get("batchId");

    if (!batchId) {
      return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
    }

    const batch = await getAssignmentBatch(batchId);

    return NextResponse.json(batch, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error: any) {
    console.error("Assignment progress GET failed:", error);

    return NextResponse.json(
      { error: error.message ?? "Failed to read assignment progress." },
      { status: error.message === "FORBIDDEN" ? 403 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(["admin"]);
    const body = await req.json();

    const phase = String(body.phase ?? "") as WorkflowPhase;

    // Default was too small for large imports. Use 5000 unless the UI sends a value.
    const parsedLimit = Number(body.limit ?? 5000);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5000;

    if (!allowedPhases.includes(phase)) {
      return NextResponse.json({ error: "Invalid assignment phase." }, { status: 400 });
    }

    const batchId = await createAssignmentBatch(phase, user.id);

    await audit({
      actorId: user.id,
      action: "auto_assignment_started",
      entityType: "assignment_batch",
      entityId: batchId,
      after: { phase, limit },
    });

    // More reliable than a floating Promise in serverless.
    after(async () => {
      try {
        await processAutoAssignPending(batchId, phase, limit, user.id);
      } catch (error) {
        console.error("Background assignment failed:", error);
      }
    });

    return NextResponse.json(
      { ok: true, batchId, message: "Assignment started" },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error: any) {
    console.error("Assignment POST failed:", error);

    return NextResponse.json(
      { error: error.message ?? "Assignment failed to start." },
      { status: error.message === "FORBIDDEN" ? 403 : 500 }
    );
  }
}