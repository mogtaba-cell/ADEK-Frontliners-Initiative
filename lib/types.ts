export type Role =
  | "admin"
  | "coordinator"
  | "evaluator"
  | "management"
  | "proofreader"
  | "reviewer"
  | "adek_hq";

export type ProofreaderType = "general" | "literary";

export type WorkflowPhase =
  | "coordinator_check"
  | "adek_evaluation"
  | "management_review"
  | "proofreading"
  | "literary_proofreading"
  | "final_review";

export type WorkflowStatus =
  | "imported"
  | "coordinator_pending"
  | "returned_for_correction"
  | "ready_for_adek"
  | "adek_in_progress"
  | "approved"
  | "needs_management_review"
  | "disqualified"
  | "selected_for_proofreading"
  | "proofreading_in_progress"
  | "proofreading_done"
  | "final_review_in_progress"
  | "completed";

export type AssignmentStatus =
  | "assigned"
  | "in_progress"
  | "completed"
  | "reassigned"
  | "cancelled";

export type Decision = "pending" | "approved" | "needs_review" | "disqualified";
