export type Role =
  | "admin"
  | "coordinator"
  | "evaluator"
  | "management"
  | "proofreader"
  | "reviewer"
  | "categorizer"
  | "rater"
  | "literary_subcategorizer"
  | "adek_hq";

export type ProofreaderType =
  | "general"
  | "literary"
  | "literary_arabic"
  | "literary_english_or_others";

export type WorkflowPhase =
  | "coordinator_check"
  | "adek_evaluation"
  | "management_review"
  | "proofreading"
  | "literary_proofreading"
  | "final_review"
  | "categorization"
  | "artistic_ranking"
  | "literary_subcategorization";

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
  | "ready_for_categorization"
  | "ready_for_artistic_ranking"
  | "ready_for_literary_subcategorization"
  | "completed";

export type AssignmentStatus =
  | "assigned"
  | "in_progress"
  | "completed"
  | "returned_for_correction"
  | "sent_for_review"
  | "reassigned"
  | "cancelled";

export type Decision = "pending" | "approved" | "needs_review" | "disqualified";
