import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ProofreaderType, Role, WorkflowPhase } from "@/lib/types";

const phaseToRole: Record<WorkflowPhase, Role> = {
  coordinator_check: "coordinator",
  adek_evaluation: "evaluator",
  management_review: "management",
  proofreading: "proofreader",
  literary_proofreading: "proofreader",
  final_review: "reviewer",
};

export const activeAssignmentStatuses = [
  "assigned",
  "in_progress",
  "returned_for_correction",
  "sent_for_review",
];

const workloadAssignmentStatuses = [
  "assigned",
  "in_progress",
  "returned_for_correction",
  "sent_for_review",
  "completed",
];

const completedStatuses = ["completed"];

type SubmissionForAssignment = {
  id: string;
  reference_id?: string | null;
  workflow_status?: string | null;
  registration_status?: string | null;
  art_pathway_name_en?: string | null;
  art_pathway_name_ar?: string | null;
  art_sub_pathway_name_en?: string | null;
  art_sub_pathway_name_ar?: string | null;
  literary_language?: string | null;
};

export type EvaluatorAssignmentTarget = {
  evaluatorId: string;
  quantity: number;
};

function eligibleStatusForPhase(phase: WorkflowPhase) {
  if (phase === "adek_evaluation") return ["ready_for_adek", "coordinator_pending", "imported"];
  if (phase === "coordinator_check") return ["returned_for_correction"];
  if (phase === "management_review") return ["needs_management_review"];
  if (phase === "proofreading") return ["selected_for_proofreading"];
  if (phase === "literary_proofreading") return ["selected_for_proofreading"];
  if (phase === "final_review") return ["proofreading_done"];
  return [];
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => any
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);

    if (error) throw error;

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

function schoolKeyFromSubmission(submission: {
  institution_ref_number?: string | null;
  institution_name?: string | null;
}) {
  return (
    String(submission?.institution_ref_number ?? "").trim() ||
    String(submission?.institution_name ?? "").trim() ||
    "Unknown School"
  );
}

function isLiteraryPathway(
  pathway: string | null | undefined,
  subpathway?: string | null | undefined,
  pathwayAr?: string | null | undefined,
  subpathwayAr?: string | null | undefined
) {
  const combined = `${pathway ?? ""} ${subpathway ?? ""} ${pathwayAr ?? ""} ${subpathwayAr ?? ""}`.toLowerCase();
  return (
    combined.includes("literary") ||
    combined.includes("الأدبية") ||
    combined.includes("الادبية") ||
    combined.includes("ادبية") ||
    combined.includes("التعبيرات الأدبية") ||
    combined.includes("التعبيرات الادبية")
  );
}

function literaryProofreaderTypeForSubmission(
  submission: Pick<SubmissionForAssignment, "literary_language" | "reference_id" | "id">
): ProofreaderType {
  if (submission.literary_language === "arabic") return "literary_arabic";
  if (submission.literary_language === "english_or_others") return "literary_english_or_others";

  throw new Error(
    `${submission.reference_id ?? submission.id}: Literary language is not classified yet. Admin must set Arabic or English/Others before literary proofreading can be assigned.`
  );
}

async function getActiveUsers(
  role: Role,
  options?: { proofreaderType?: ProofreaderType }
) {
  let query = supabaseAdmin
    .from("profiles")
    .select("id,full_name,email,role,is_active,proofreader_type")
    .eq("role", role)
    .eq("is_active", true);

  if (role === "proofreader" && options?.proofreaderType) {
    query = query.eq("proofreader_type", options.proofreaderType);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function getLeastLoadedUser(
  role: Role,
  options?: {
    phase?: WorkflowPhase;
    proofreaderType?: ProofreaderType;
    candidateIds?: string[];
  }
) {
  let users = await getActiveUsers(role, {
    proofreaderType: options?.proofreaderType,
  });

  if (options?.candidateIds?.length) {
    const candidates = new Set(options.candidateIds);
    users = users.filter((user) => candidates.has(user.id));
  }

  if (!users.length) {
    throw new Error(
      `No active ${options?.proofreaderType ? `${options.proofreaderType} ` : ""}${role} users available.`
    );
  }

  const userIds = users.map((user) => user.id);

  const assignments = await fetchAllRows<{
    assigned_to: string | null;
    submission_id: string | null;
  }>((from, to) => {
    let query = supabaseAdmin
      .from("assignments")
      .select("assigned_to,submission_id")
      .in("assigned_to", userIds)
      .in("status", workloadAssignmentStatuses);

    if (options?.phase) query = query.eq("phase", options.phase);

    return query.range(from, to);
  });

  const workload = new Map<string, Set<string>>();
  for (const user of users) workload.set(user.id, new Set());

  for (const row of assignments) {
    if (!row.assigned_to || !row.submission_id) continue;
    workload.get(row.assigned_to)?.add(row.submission_id);
  }

  return Array.from(workload.entries()).sort((a, b) => a[1].size - b[1].size)[0][0];
}

async function getCoordinatorForSchool(submissionId: string) {
  const { data: submission, error: submissionError } = await supabaseAdmin
    .from("submissions")
    .select("institution_ref_number,institution_name")
    .eq("id", submissionId)
    .single();

  if (submissionError) throw submissionError;

  const schoolKey = schoolKeyFromSubmission(submission ?? {});
  const coordinators = await getActiveUsers("coordinator");

  if (!coordinators.length) {
    throw new Error("No active coordinator users available.");
  }

  const activeCoordinatorIds = new Set(coordinators.map((coordinator) => coordinator.id));

  const existingSchoolAssignments = await fetchAllRows<any>((from, to) =>
    supabaseAdmin
      .from("assignments")
      .select(
        `
        assigned_to,
        created_at,
        submissions!inner(
          institution_ref_number,
          institution_name
        )
        `
      )
      .eq("phase", "coordinator_check")
      .in("status", workloadAssignmentStatuses)
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  for (const assignment of existingSchoolAssignments) {
    const assignedSchoolKey = schoolKeyFromSubmission((assignment as any).submissions ?? {});

    if (
      assignedSchoolKey === schoolKey &&
      assignment.assigned_to &&
      activeCoordinatorIds.has(assignment.assigned_to)
    ) {
      return assignment.assigned_to;
    }
  }

  return getLeastLoadedUser("coordinator", { phase: "coordinator_check" });
}

export async function autoAssignOne(
  submissionId: string,
  phase: WorkflowPhase,
  actorId?: string,
  options?: {
    assignedTo?: string;
    proofreaderType?: ProofreaderType;
    requestedByUserId?: string | null;
    returnToUserId?: string | null;
    correctionReason?: string | null;
    correctionNotes?: string | null;
    correctionSourcePhase?: WorkflowPhase | null;
    correctionSourceAssignmentId?: string | null;
  }
) {
  const existing = await supabaseAdmin
    .from("assignments")
    .select("id,status")
    .eq("submission_id", submissionId)
    .eq("phase", phase)
    .in("status", activeAssignmentStatuses)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data) {
    return {
      id: existing.data.id,
      skipped: true,
      reason: "Already has an active task for this phase.",
    };
  }

  const role = phaseToRole[phase];
  let assignedTo = options?.assignedTo;

  if (!assignedTo && phase === "coordinator_check") {
    assignedTo = await getCoordinatorForSchool(submissionId);
  }

  if (!assignedTo) {
    assignedTo = await getLeastLoadedUser(role, {
      phase,
      proofreaderType: options?.proofreaderType,
    });
  }

  const { data, error } = await supabaseAdmin
    .from("assignments")
    .insert({
      submission_id: submissionId,
      phase,
      assigned_to: assignedTo,
      assigned_by: actorId ?? null,
      requested_by_user_id: options?.requestedByUserId ?? null,
      return_to_user_id: options?.returnToUserId ?? null,
      correction_reason: options?.correctionReason ?? null,
      correction_notes: options?.correctionNotes ?? null,
      correction_source_phase: options?.correctionSourcePhase ?? null,
      correction_source_assignment_id: options?.correctionSourceAssignmentId ?? null,
      proofreader_type: options?.proofreaderType ?? null,
      status: "assigned",
    })
    .select("id")
    .single();

  if (error) throw error;

  return { id: data.id, skipped: false, assigned_to: assignedTo };
}

export async function reactivateAssignmentForReturn(
  assignmentId: string,
  actorId: string,
  options?: {
    assignedTo?: string | null;
    requestedByUserId?: string | null;
    correctionReason?: string | null;
    correctionNotes?: string | null;
  }
) {
  const updateValues: Record<string, any> = {
    status: "assigned",
    completed_at: null,
    started_at: null,
    locked_by: null,
    lock_expires_at: null,
    assigned_by: actorId,
    requested_by_user_id: options?.requestedByUserId ?? null,
    return_to_user_id: options?.assignedTo ?? null,
    correction_reason: options?.correctionReason ?? null,
    correction_notes: options?.correctionNotes ?? null,
    updated_at: new Date().toISOString(),
  };

  if (options?.assignedTo) updateValues.assigned_to = options.assignedTo;

  const { data, error } = await supabaseAdmin
    .from("assignments")
    .update(updateValues)
    .eq("id", assignmentId)
    .select("id,assigned_to")
    .single();

  if (error) throw error;
  return data;
}

async function hasAnyPhaseAssignment(submissionId: string, phase: WorkflowPhase) {
  const { count, error } = await supabaseAdmin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("phase", phase);

  if (error) throw error;
  return (count ?? 0) > 0;
}

async function hasActivePhaseAssignment(submissionId: string, phase: WorkflowPhase) {
  const { count, error } = await supabaseAdmin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("phase", phase)
    .in("status", activeAssignmentStatuses);

  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function countUnassignedAdekSubmissions() {
  const submittedSubmissions = await fetchAllRows<{ id: string }>((from, to) =>
    supabaseAdmin
      .from("submissions")
      .select("id")
      .eq("registration_status", "Submitted")
      .range(from, to)
  );

  const submissionIds = submittedSubmissions.map((row) => row.id).filter(Boolean);
  if (!submissionIds.length) return 0;

  const assignedIds = new Set<string>();
  for (const chunk of chunkArray(submissionIds, 500)) {
    const { data: assignments, error: assignmentError } = await supabaseAdmin
      .from("assignments")
      .select("submission_id")
      .eq("phase", "adek_evaluation")
      .in("submission_id", chunk);

    if (assignmentError) throw assignmentError;
    for (const row of assignments ?? []) assignedIds.add(row.submission_id);
  }

  return submissionIds.filter((id) => !assignedIds.has(id)).length;
}

export async function getEvaluatorAssignmentWorkloads() {
  const { data: evaluators, error: evaluatorsError } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,email")
    .eq("role", "evaluator")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (evaluatorsError) throw evaluatorsError;

  const evaluatorIds = (evaluators ?? []).map((evaluator) => evaluator.id);

  type EvaluatorWorkloadSets = {
    total: Set<string>;
    remaining: Set<string>;
    sentForCorrection: Set<string>;
    completed: Set<string>;
  };

  const workload = new Map<string, EvaluatorWorkloadSets>();

  for (const id of evaluatorIds) {
    workload.set(id, {
      total: new Set(),
      remaining: new Set(),
      sentForCorrection: new Set(),
      completed: new Set(),
    });
  }

  if (evaluatorIds.length) {
    const assignments = await fetchAllRows<{
      assigned_to: string | null;
      submission_id: string | null;
      status: string | null;
      completed_at: string | null;
    }>((from, to) =>
      supabaseAdmin
        .from("assignments")
        .select("assigned_to,submission_id,status,completed_at")
        .eq("phase", "adek_evaluation")
        .in("assigned_to", evaluatorIds)
        .range(from, to)
    );

    for (const assignment of assignments) {
      if (!assignment.assigned_to || !assignment.submission_id) continue;

      const row = workload.get(assignment.assigned_to);
      if (!row) continue;

      const status = String(assignment.status ?? "");

      if (workloadAssignmentStatuses.includes(status)) {
        row.total.add(assignment.submission_id);
      }

      if (["assigned", "in_progress"].includes(status)) {
        row.remaining.add(assignment.submission_id);
      }

      if (status === "returned_for_correction") {
        row.sentForCorrection.add(assignment.submission_id);
      }

      if (status === "completed" && assignment.completed_at) {
        row.completed.add(assignment.submission_id);
      }
    }
  }

  return (evaluators ?? []).map((evaluator) => {
    const stats = workload.get(evaluator.id);

    return {
      ...evaluator,
      assigned_total: stats?.total.size ?? 0,
      remaining: stats?.remaining.size ?? 0,
      sent_for_correction: stats?.sentForCorrection.size ?? 0,
      completed: stats?.completed.size ?? 0,
    };
  });
}

export async function assignAdekToEvaluatorQuantities(
  targets: EvaluatorAssignmentTarget[],
  actorId?: string
) {
  const cleanedTargets = targets
    .map((target) => ({ evaluatorId: target.evaluatorId, quantity: Math.max(0, Math.floor(Number(target.quantity) || 0)) }))
    .filter((target) => target.evaluatorId && target.quantity > 0);

  if (!cleanedTargets.length) {
    throw new Error("Enter at least one evaluator quantity greater than zero.");
  }

  const evaluatorIds = Array.from(new Set(cleanedTargets.map((target) => target.evaluatorId)));
  const { data: evaluators, error: evaluatorsError } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,email")
    .eq("role", "evaluator")
    .eq("is_active", true)
    .in("id", evaluatorIds);

  if (evaluatorsError) throw evaluatorsError;

  const validEvaluatorIds = new Set((evaluators ?? []).map((evaluator) => evaluator.id));
  const invalidTargets = evaluatorIds.filter((id) => !validEvaluatorIds.has(id));
  if (invalidTargets.length) throw new Error("One or more selected evaluators are inactive or invalid.");

  const totalRequested = cleanedTargets.reduce((sum, target) => sum + target.quantity, 0);

  const submissions = await fetchAllRows<{ id: string; reference_id: string | null; created_at: string | null }>(
    (from, to) =>
      supabaseAdmin
        .from("submissions")
        .select("id,reference_id,created_at")
        .eq("registration_status", "Submitted")
        .order("created_at", { ascending: true })
        .order("reference_id", { ascending: true })
        .range(from, to)
  );

  const submissionIds = submissions.map((submission) => submission.id).filter(Boolean);
  const alreadyAssigned = new Set<string>();

  for (const chunk of chunkArray(submissionIds, 500)) {
    if (!chunk.length) continue;
    const { data, error } = await supabaseAdmin
      .from("assignments")
      .select("submission_id")
      .eq("phase", "adek_evaluation")
      .in("submission_id", chunk);

    if (error) throw error;
    for (const row of data ?? []) alreadyAssigned.add(row.submission_id);
  }

  const availableSubmissions = submissions.filter((submission) => !alreadyAssigned.has(submission.id));

  if (totalRequested > availableSubmissions.length) {
    throw new Error(
      `You requested ${totalRequested} assignments, but only ${availableSubmissions.length} unassigned artworks are available.`
    );
  }

  const assignmentsToInsert: any[] = [];
  let cursor = 0;

  for (const target of cleanedTargets) {
    for (let i = 0; i < target.quantity; i++) {
      const submission = availableSubmissions[cursor++];
      if (!submission) break;
      assignmentsToInsert.push({
        submission_id: submission.id,
        phase: "adek_evaluation",
        assigned_to: target.evaluatorId,
        assigned_by: actorId ?? null,
        status: "assigned",
      });
    }
  }

  for (const chunk of chunkArray(assignmentsToInsert, 500)) {
    const { error } = await supabaseAdmin.from("assignments").insert(chunk);
    if (error) throw error;
  }

  if (assignmentsToInsert.length) {
    const ids = assignmentsToInsert.map((assignment) => assignment.submission_id);
    for (const chunk of chunkArray(ids, 500)) {
      const { error } = await supabaseAdmin
        .from("submissions")
        .update({ workflow_status: "ready_for_adek", updated_at: new Date().toISOString() })
        .in("id", chunk);
      if (error) throw error;
    }
  }

  return {
    assigned: assignmentsToInsert.length,
    requested: totalRequested,
    available_before: availableSubmissions.length,
    available_after: availableSubmissions.length - assignmentsToInsert.length,
    per_evaluator: cleanedTargets.map((target) => ({
      evaluator_id: target.evaluatorId,
      requested: target.quantity,
      assigned: assignmentsToInsert.filter((assignment) => assignment.assigned_to === target.evaluatorId).length,
    })),
  };
}

export async function autoAssignPending(
  phase: WorkflowPhase,
  limit = 5000,
  actorId?: string
) {
  if (phase === "adek_evaluation") {
    throw new Error("ADEK evaluator assignments must be created from Admin Dashboard using evaluator quantities.");
  }

  const eligibleStatuses = eligibleStatusForPhase(phase);
  let query = supabaseAdmin
    .from("submissions")
    .select(
      "id,reference_id,workflow_status,registration_status,art_pathway_name_en,art_pathway_name_ar,art_sub_pathway_name_en,art_sub_pathway_name_ar,literary_language"
    )
    .in("workflow_status", eligibleStatuses)
    .limit(limit);

  const { data: submissions, error } = await query;
  if (error) throw error;

  let assigned = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const submission of (submissions ?? []) as SubmissionForAssignment[]) {
    try {
      let proofreaderType: ProofreaderType | undefined;

      if (await hasActivePhaseAssignment(submission.id, phase)) {
        skipped++;
        continue;
      }

      if (phase === "proofreading") {
        if (await hasAnyPhaseAssignment(submission.id, "proofreading")) {
          skipped++;
          continue;
        }
        proofreaderType = "general";
      }

      if (phase === "literary_proofreading") {
        if (
          !isLiteraryPathway(
            submission.art_pathway_name_en,
            submission.art_sub_pathway_name_en,
            submission.art_pathway_name_ar,
            submission.art_sub_pathway_name_ar
          )
        ) {
          skipped++;
          continue;
        }

        if (await hasAnyPhaseAssignment(submission.id, "literary_proofreading")) {
          skipped++;
          continue;
        }

        proofreaderType = literaryProofreaderTypeForSubmission(submission);
      }

      if (phase === "management_review") {
        if (await hasAnyPhaseAssignment(submission.id, "management_review")) {
          skipped++;
          continue;
        }
      }

      if (phase === "final_review") {
        if (!(await isReadyForFinalReview(submission.id))) {
          skipped++;
          continue;
        }
        if (await hasAnyPhaseAssignment(submission.id, "final_review")) {
          skipped++;
          continue;
        }
      }

      const result = await autoAssignOne(submission.id, phase, actorId, {
        proofreaderType,
      });

      if (result.skipped) skipped++;
      else assigned++;
    } catch (error: any) {
      skipped++;
      errors.push(`${submission.reference_id ?? submission.id}: ${error?.message ?? "Assignment failed"}`);
    }
  }

  return { phase, eligible: submissions?.length ?? 0, assigned, skipped, errors };
}

export async function assignAdekAfterImport(_submissionId: string, _actorId?: string) {
  return { skipped: true, reason: "Imports no longer auto-assign ADEK evaluator tasks." };
}

export async function assignProofreadingAfterApproval(
  submissionId: string,
  actorId?: string
) {
  const { data: submission, error } = await supabaseAdmin
    .from("submissions")
    .select(
      "id,reference_id,art_pathway_name_en,art_pathway_name_ar,art_sub_pathway_name_en,art_sub_pathway_name_ar,literary_language"
    )
    .eq("id", submissionId)
    .single();

  if (error) throw error;

  const generalAlreadyExists = await hasAnyPhaseAssignment(submissionId, "proofreading");
  const general = generalAlreadyExists
    ? { skipped: true, reason: "General proofreading task already exists." }
    : await autoAssignOne(submissionId, "proofreading", actorId, {
        proofreaderType: "general",
      });

  let literary: Awaited<ReturnType<typeof autoAssignOne>> | { skipped: boolean; reason: string } | null = null;
  let literarySkippedReason: string | null = null;

  if (
    isLiteraryPathway(
      submission?.art_pathway_name_en,
      submission?.art_sub_pathway_name_en,
      submission?.art_pathway_name_ar,
      submission?.art_sub_pathway_name_ar
    )
  ) {
    if (
      submission.literary_language === "arabic" ||
      submission.literary_language === "english_or_others"
    ) {
      const proofreaderType = literaryProofreaderTypeForSubmission(submission);
      const literaryAlreadyExists = await hasAnyPhaseAssignment(submissionId, "literary_proofreading");
      literary = literaryAlreadyExists
        ? { skipped: true, reason: "Literary proofreading task already exists." }
        : await autoAssignOne(submissionId, "literary_proofreading", actorId, {
            proofreaderType,
          });
    } else {
      literarySkippedReason =
        "Literary language is not classified yet. General proofreading was assigned. Literary proofreading will be assigned after Admin classifies the language.";
    }
  }

  return { general, literary, literarySkippedReason };
}

async function hasCompletedPhase(submissionId: string, phase: WorkflowPhase) {
  const { count, error } = await supabaseAdmin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("phase", phase)
    .eq("status", "completed")
    .not("completed_at", "is", null);

  if (error) throw error;
  return (count ?? 0) > 0;
}

async function hasActivePhase(submissionId: string, phase: WorkflowPhase) {
  const { count, error } = await supabaseAdmin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("phase", phase)
    .in("status", activeAssignmentStatuses);

  if (error) throw error;
  return (count ?? 0) > 0;
}

async function isLiterarySubmission(submissionId: string) {
  const { data: submission, error } = await supabaseAdmin
    .from("submissions")
    .select("art_pathway_name_en,art_pathway_name_ar,art_sub_pathway_name_en,art_sub_pathway_name_ar,literary_language")
    .eq("id", submissionId)
    .single();

  if (error) throw error;

  return isLiteraryPathway(
    submission?.art_pathway_name_en,
    submission?.art_sub_pathway_name_en,
    submission?.art_pathway_name_ar,
    submission?.art_sub_pathway_name_ar
  );
}

async function hasPendingManagementReview(submissionId: string) {
  return hasActivePhase(submissionId, "management_review");
}

export async function isReadyForFinalReview(submissionId: string) {
  const adekDone = await hasCompletedPhase(submissionId, "adek_evaluation");
  const generalDone = await hasCompletedPhase(submissionId, "proofreading");
  const literaryRequired = await isLiterarySubmission(submissionId);
  const literaryDone = literaryRequired
    ? await hasCompletedPhase(submissionId, "literary_proofreading")
    : true;
  const activeCorrection = await hasActivePhase(submissionId, "coordinator_check");
  const activeManagement = await hasPendingManagementReview(submissionId);

  return adekDone && generalDone && literaryDone && !activeCorrection && !activeManagement;
}

async function getReviewerForProofreader(generalProofreaderId: string) {
  const { data: links, error } = await supabaseAdmin
    .from("reviewer_proofreader_links")
    .select("reviewer_id")
    .eq("proofreader_id", generalProofreaderId);

  if (error) throw error;

  const linkedReviewerIds = (links ?? []).map((row) => row.reviewer_id).filter(Boolean);

  return getLeastLoadedUser("reviewer", {
    phase: "final_review",
    candidateIds: linkedReviewerIds.length ? linkedReviewerIds : undefined,
  });
}

export async function maybeAssignReviewerAfterProofreading(
  submissionId: string,
  generalProofreaderId: string,
  actorId?: string
) {
  const ready = await isReadyForFinalReview(submissionId);

  if (!ready) {
    return { assigned: false, waiting_for: "previous_stages" };
  }

  if (await hasAnyPhaseAssignment(submissionId, "final_review")) {
    return { assigned: false, waiting_for: "already_has_final_review" };
  }

  const assignedTo = await getReviewerForProofreader(generalProofreaderId);

  const result = await autoAssignOne(submissionId, "final_review", actorId, {
    assignedTo,
    requestedByUserId: generalProofreaderId,
  });

  await supabaseAdmin
    .from("submissions")
    .update({ workflow_status: "proofreading_done", updated_at: new Date().toISOString() })
    .eq("id", submissionId);

  return { assigned: !result.skipped, reviewer_id: assignedTo, result };
}

export async function createAssignmentBatch(phase: WorkflowPhase, actorId: string) {
  const { data, error } = await supabaseAdmin
    .from("assignment_batches")
    .insert({
      phase,
      status: "queued",
      current_step: "Assignment request received",
      started_by: actorId,
      eligible_count: 0,
      processed_count: 0,
      assigned_count: 0,
      skipped_count: 0,
      error_count: 0,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function getAssignmentBatch(batchId: string) {
  const { data, error } = await supabaseAdmin
    .from("assignment_batches")
    .select("id,phase,status,current_step,eligible_count,processed_count,assigned_count,skipped_count,error_count,error_message,started_by,started_at,completed_at,created_at")
    .eq("id", batchId)
    .single();

  if (error) throw error;

  const { data: errors } = await supabaseAdmin
    .from("assignment_batch_errors")
    .select("reference_id,error_message,created_at")
    .eq("assignment_batch_id", batchId)
    .order("created_at", { ascending: false })
    .limit(10);

  return { ...data, recent_errors: errors ?? [] };
}

export async function processAutoAssignPending(
  batchId: string,
  phase: WorkflowPhase,
  limit = 5000,
  actorId?: string
) {
  try {
    await supabaseAdmin
      .from("assignment_batches")
      .update({
        status: "processing",
        current_step: `Assigning ${phase}`,
        started_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    const result = await autoAssignPending(phase, limit, actorId);

    if (result.errors.length > 0) {
      for (const chunk of chunkArray(result.errors, 500)) {
        const { error } = await supabaseAdmin.from("assignment_batch_errors").insert(
          chunk.map((message) => ({
            assignment_batch_id: batchId,
            reference_id: null,
            error_message: message,
          }))
        );
        if (error) throw error;
      }
    }

    await supabaseAdmin
      .from("assignment_batches")
      .update({
        status: "completed",
        current_step: "Assignment completed",
        eligible_count: result.eligible,
        processed_count: result.eligible,
        assigned_count: result.assigned,
        skipped_count: result.skipped,
        error_count: result.errors.length,
        completed_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    try {
      await supabaseAdmin.rpc("refresh_analytics_materialized_views");
    } catch (error) {
      console.error("Analytics refresh after assignment failed:", error);
    }
  } catch (error: any) {
    await supabaseAdmin
      .from("assignment_batches")
      .update({
        status: "failed",
        current_step: "Assignment failed",
        error_message: error?.message ?? "Assignment failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", batchId);
  }
}
