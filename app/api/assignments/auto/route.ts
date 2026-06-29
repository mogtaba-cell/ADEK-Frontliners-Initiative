import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  assignAdekToEvaluatorQuantities,
  repairMissingAssignments,
  type EvaluatorAssignmentTarget,
  type RepairMissingAssignmentsScope,
} from "@/lib/assignment";
import type { WorkflowPhase } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPAIR_PHASES: RepairMissingAssignmentsScope[] = [
  "coordinator_check",
  "management_review",
  "proofreading",
  "literary_proofreading",
  "final_review",
  "categorization",
  "artistic_ranking",
  "literary_subcategorization",
];

function redirectToAdmin(req: Request, params: Record<string, string | number>) {
  const url = new URL("/admin", req.url);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  url.searchParams.set("refresh", Date.now().toString());
  return NextResponse.redirect(url, { status: 303 });
}

function parseEvaluatorTargets(form: FormData): EvaluatorAssignmentTarget[] {
  const targets: EvaluatorAssignmentTarget[] = [];

  for (const [key, value] of form.entries()) {
    if (!key.startsWith("quantity_")) continue;

    const evaluatorId = key.slice("quantity_".length).trim();
    const quantity = Number(value);

    if (!evaluatorId || !Number.isFinite(quantity) || quantity <= 0) continue;

    targets.push({
      evaluatorId,
      quantity: Math.floor(quantity),
    });
  }

  return targets;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(["admin"]);
    const form = await req.formData();
    const phase = String(form.get("phase") ?? "").trim() as WorkflowPhase;

    if (!phase) {
      throw new Error("Missing repair phase.");
    }

    if (phase === "adek_evaluation") {
      const targets = parseEvaluatorTargets(form);
      const result = await assignAdekToEvaluatorQuantities(targets, user.id);

      return redirectToAdmin(req, {
        maintenance: "adek_evaluation",
        assigned: result.assigned,
        skipped: Math.max(result.requested - result.assigned, 0),
      });
    }

    if (!REPAIR_PHASES.includes(phase as RepairMissingAssignmentsScope)) {
      throw new Error(`Unsupported repair phase: ${phase}`);
    }

    const result = await repairMissingAssignments(
      user.id,
      phase as RepairMissingAssignmentsScope
    );

    return redirectToAdmin(req, {
      maintenance: phase,
      assigned: result.assigned,
      skipped: result.skipped,
      errors: result.errors.length,
    });
  } catch (error: any) {
    return redirectToAdmin(req, {
      maintenance_error: error?.message ?? "Assignment repair failed.",
    });
  }
}
