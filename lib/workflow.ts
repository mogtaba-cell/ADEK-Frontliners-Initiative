import type { Role, WorkflowPhase, WorkflowStatus } from "@/lib/types";

export const roleHome: Record<Role, string> = {
  admin: "/admin",
  coordinator: "/coordinator",
  evaluator: "/evaluator",
  management: "/management",
  proofreader: "/proofreader",
  reviewer: "/reviewer",
  adek_hq: "/submissions",
};

export const rolePhase: Partial<Record<Role, WorkflowPhase>> = {
  coordinator: "coordinator_check",
  evaluator: "adek_evaluation",
  management: "management_review",
  proofreader: "proofreading",
  reviewer: "final_review",
};

export const phaseLabels: Record<WorkflowPhase, string> = {
  coordinator_check: "Coordinator Correction",
  adek_evaluation: "ADEK Evaluation",
  management_review: "Management Review",
  proofreading: "General Proofreading",
  literary_proofreading: "Literary Proofreading",
  final_review: "Final Review",
};

export const workflowLabels: Record<WorkflowStatus, string> = {
  imported: "Imported",
  coordinator_pending: "Coordinator Pending",
  returned_for_correction: "Returned for Correction",
  ready_for_adek: "Ready for ADEK",
  adek_in_progress: "ADEK In Progress",
  approved: "Approved",
  needs_management_review: "Needs Management Review",
  disqualified: "Disqualified",
  selected_for_proofreading: "Selected for Proofreading",
  proofreading_in_progress: "Proofreading In Progress",
  proofreading_done: "Proofreading Done",
  final_review_in_progress: "Final Review In Progress",
  completed: "Completed",
};

export function labelWorkflowStatus(status: string | null | undefined) {
  return workflowLabels[status as WorkflowStatus] ?? status ?? "-";
}

export function labelPhase(phase: string | null | undefined) {
  return phaseLabels[phase as WorkflowPhase] ?? phase ?? "-";
}

export function isCompletedAssignment(status: string | null | undefined) {
  return status === "completed";
}

export function statusClassName(status: string | null | undefined) {
  const value = String(status ?? "").toLowerCase();

  if (["completed", "approved", "proofreading_done"].includes(value)) {
    return "pill pill-success";
  }

  if (["needs_management_review", "returned_for_correction"].includes(value)) {
    return "pill pill-warning";
  }

  if (["disqualified", "cancelled"].includes(value)) {
    return "pill pill-danger";
  }

  if (["in_progress", "adek_in_progress", "proofreading_in_progress", "final_review_in_progress"].includes(value)) {
    return "pill pill-info";
  }

  return "pill";
}
