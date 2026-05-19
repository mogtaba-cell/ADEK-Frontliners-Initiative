import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  autoAssignPending,
  createAssignmentBatch,
  processAutoAssignPending,
  processAutoAssignPendingToEvaluators,
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

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url, {
    status: 303,
  });
}

async function readPayload(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return {
      payload: await req.json(),
      wantsJson: true,
    };
  }

  const form = await req.formData();

  return {
    payload: {
      phase: String(form.get("phase") ?? ""),
      limit: Number(form.get("limit") ?? 5000),
      evaluator_ids: form.getAll("evaluator_ids").map((value) => String(value)),
    },
    wantsJson: false,
  };
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(["admin"]);
    const { payload, wantsJson } = await readPayload(req);

    const phase = String(payload.phase ?? "");
    const limit = Number.isFinite(Number(payload.limit))
      ? Number(payload.limit)
      : 5000;
    const evaluatorIds = Array.isArray(payload.evaluator_ids)
      ? payload.evaluator_ids.map((value: unknown) => String(value)).filter(Boolean)
      : [];

    if (!phase) {
      throw new Error("Missing assignment phase.");
    }

    if (phase === "adek_evaluation") {
      if (!evaluatorIds.length) {
        if (wantsJson) {
          return NextResponse.json(
            {
              ok: false,
              error: "Select at least one evaluator before assigning artworks.",
            },
            { status: 400 }
          );
        }

        return redirectBack(req, {
          maintenance_error: "select_evaluators",
        });
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

      if (wantsJson) {
        return NextResponse.json({
          ok: true,
          phase: "adek_evaluation",
          batchId,
        });
      }

      return redirectBack(req, {
        maintenance: "assigned",
        phase: "adek_evaluation",
        assignment_batch: batchId,
      });
    }

    if (phase === "repair_missing") {
      const results = await Promise.all(
        repairPhases.map(async (repairPhase) => {
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

          await processAutoAssignPending(repairPhase, limit, user.id);

          return {
            phase: repairPhase,
            ok: true,
            batchId,
          };
        })
      );

      if (wantsJson) {
        return NextResponse.json({
          ok: true,
          mode: "repair_missing",
          results,
        });
      }

      return redirectBack(req, {
        maintenance: "repair_completed",
      });
    }

    // JSON-only compatibility for old admin tools. ADEK is blocked above;
    // repair_missing is preferred for UI repairs.
    if (phase === "management_review") {
      throw new Error(
        "Management tasks are created by the ADEK evaluation workflow, not by Repair Missing Assignments."
      );
    }

    const result = await autoAssignPending(
      phase as WorkflowPhase,
      Number.isFinite(limit) ? limit : 5000,
      user.id
    );

    if (wantsJson) {
      return NextResponse.json({
        ok: true,
        phase,
        result,
      });
    }

    return redirectBack(req, {
      maintenance: "assigned",
      phase,
    });
  } catch (error: any) {
    console.error("Auto assignment failed:", error);

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message ?? "Auto assignment failed.",
        },
        {
          status:
            error.message === "FORBIDDEN" ||
            error.message === "UNAUTHENTICATED"
              ? 403
              : 500,
        }
      );
    }

    return redirectBack(req, {
      maintenance_error: error.message ?? "Auto assignment failed.",
    });
  }
}
