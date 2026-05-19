import { redirect } from "next/navigation";
import { after } from "next/server";
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

    after(async () => {
      try {
        await processAutoAssignPendingToEvaluators(
          batchId,
          evaluatorIds,
          limit,
          user.id
        );
      } catch (error) {
        console.error("Manual evaluator assignment failed:", error);
      }
    });

    redirect(`/admin?assignment_batch=${batchId}`);
  }

  if (phase === "repair_missing") {
    const createdBatches: {
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

      createdBatches.push({
        phase: repairPhase,
        batchId,
      });
    }

    after(async () => {
      for (const batch of createdBatches) {
        try {
          await processAutoAssignPending(
            batch.batchId,
            batch.phase,
            limit,
            user.id
          );
        } catch (error) {
          console.error(`Repair failed for ${batch.phase}:`, error);
        }
      }
    });

    const firstBatchId = createdBatches[0]?.batchId;

    redirect(
      firstBatchId
        ? `/admin?repair=started&assignment_batch=${firstBatchId}`
        : "/admin?repair=started"
    );
  }

  redirect("/admin?error=invalid_assignment_phase");
}