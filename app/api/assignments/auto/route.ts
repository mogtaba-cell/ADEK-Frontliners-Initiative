import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  assignAdekToEvaluatorQuantities,
  autoAssignPending,
  createAssignmentBatch,
  processAutoAssignPending,
} from "@/lib/assignment";
import type { WorkflowPhase } from "@/lib/types";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const repairPhases: WorkflowPhase[] = [
  "coordinator_check",
  "proofreading",
  "literary_proofreading",
  "final_review",
];

function redirectBack(req: Request, params: Record<string, string>) {
  const url = new URL("/admin", req.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, { status: 303 });
}

async function readPayload(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return { payload: await req.json(), wantsJson: true };
  }

  const form = await req.formData();
  const quantities: Record<string, number> = {};

  for (const [key, value] of form.entries()) {
    if (!key.startsWith("quantity_")) continue;
    const evaluatorId = key.replace("quantity_", "");
    const quantity = Math.max(0, Math.floor(Number(value) || 0));
    if (quantity > 0) quantities[evaluatorId] = quantity;
  }

  return {
    payload: {
      phase: String(form.get("phase") ?? ""),
      limit: Number(form.get("limit") ?? 5000),
      quantities,
    },
    wantsJson: false,
  };
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(["admin"]);
    const { payload, wantsJson } = await readPayload(req);
    const phase = String(payload.phase ?? "");
    const limit = Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : 5000;

    if (!phase) throw new Error("Missing assignment phase.");

    if (phase === "adek_evaluation") {
      const quantities = payload.quantities ?? {};
      const targets = Object.entries(quantities).map(([evaluatorId, quantity]) => ({
        evaluatorId,
        quantity: Number(quantity),
      }));

      const result = await assignAdekToEvaluatorQuantities(targets, user.id);

      await audit({
        actorId: user.id,
        action: "manual_evaluator_quantity_assignment",
        entityType: "assignments",
        entityId: "adek_evaluation",
        after: result,
      });

      if (wantsJson) return NextResponse.json({ ok: true, mode: "adek_evaluation", result });

      return redirectBack(req, {
        maintenance: `assigned_${result.assigned}_adek_tasks`,
      });
    }

    if (phase === "repair_missing") {
      const results = [];

      for (const repairPhase of repairPhases) {
        const batchId = await createAssignmentBatch(repairPhase, user.id);

        await audit({
          actorId: user.id,
          action: "repair_missing_assignment_started",
          entityType: "assignment_batch",
          entityId: batchId,
          after: { phase: repairPhase, limit },
        });

        await processAutoAssignPending(batchId, repairPhase, limit, user.id);
        results.push({ phase: repairPhase, batchId });
      }

      if (wantsJson) return NextResponse.json({ ok: true, mode: "repair_missing", results });

      return redirectBack(req, { maintenance: "repair_completed" });
    }

    if (phase === "management_review") {
      throw new Error("Management review assignments are created by workflow decisions, not manual repair.");
    }

    const result = await autoAssignPending(phase as WorkflowPhase, limit, user.id);

    if (wantsJson) return NextResponse.json({ ok: true, phase, result });

    return redirectBack(req, { maintenance: "assigned", phase });
  } catch (error: any) {
    console.error("Auto assignment failed:", error);

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return NextResponse.json(
        { ok: false, error: error.message ?? "Auto assignment failed." },
        { status: error.message === "FORBIDDEN" || error.message === "UNAUTHENTICATED" ? 403 : 500 }
      );
    }

    return redirectBack(req, { maintenance_error: error.message ?? "Auto assignment failed." });
  }
}
