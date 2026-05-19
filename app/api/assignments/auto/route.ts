import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  createAssignmentBatch,
  processAutoAssignPending,
  processAutoAssignPendingToEvaluators,
} from "@/lib/assignment";
import type { WorkflowPhase } from "@/lib/types";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const REPAIR_PHASES: WorkflowPhase[] = [
  "coordinator_check",
  "proofreading",
  "literary_proofreading",
  "final_review",
];

function parsePositiveNumber(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function POST(req: Request) {
  const user = await requireUser(["admin"]);
  const form = await req.formData();

  const phase = String(form.get("phase") ?? "") as
    | WorkflowPhase
    | "repair_missing";

  const limit = parsePositiveNumber(form.get("limit"), 5000);

  const evaluatorIds = form
    .getAll("evaluator_ids")
    .map((value) => String(value))
    .filter(Boolean);

  if (phase === "adek_evaluation") {
    if (!evaluatorIds.length) {
      redirect("/admin?error=select_evaluators");
    }

    const batchId = await createAssignmentBatch("adek_evaluation", user.id);

    await audit({
      actorId: user.id,
      action: "manual_evaluator_assignment_started",
      entityType: "assignment_batch",
      entityId: batchId,
      after: {
        phase: "adek_evaluation",
        evaluatorIds,
        limit,
      },
    });

    await processAutoAssignPendingToEvaluators(
      batchId,
      evaluatorIds,
      limit,
      user.id
    );

    redirect(`/admin?assignment_batch=${batchId}`);
  }

  if (phase === "repair_missing") {
    const repaired: {
      phase: WorkflowPhase;
      batchId: string;
    }[] = [];

    for (const repairPhase of REPAIR_PHASES) {
      const batchId = await createAssignmentBatch(repairPhase, user.id);

      await audit({
        actorId: user.id,
        action: "repair_missing_assignment_started",
        entityType: "assignment_batch",
        entityId: batchId,
        after: {
          phase: repairPhase,
          limit,
        },
      });

      await processAutoAssignPending(batchId, repairPhase, limit, user.id);

      repaired.push({
        phase: repairPhase,
        batchId,
      });
    }

    const lastBatchId = repaired[repaired.length - 1]?.batchId;

    redirect(
      lastBatchId
        ? `/admin?repair=completed&assignment_batch=${lastBatchId}`
        : "/admin?repair=completed"
    );
  }

  redirect("/admin?error=invalid_assignment_phase");
}