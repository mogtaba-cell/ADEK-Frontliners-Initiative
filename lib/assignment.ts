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

const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_IN_FILTER_CHUNK_SIZE = 100;

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

function isCancelledStatus(status: unknown) {
  return String(status ?? "").toLowerCase() === "cancelled";
}

function isRemainingAssignmentStatus(status: unknown) {
  return [
    "assigned",
    "in_progress",
    "returned_for_correction",
    "sent_for_review",
  ].includes(String(status ?? ""));
}

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
  if (phase === "adek_evaluation") {
    return ["ready_for_adek", "coordinator_pending", "imported"];
  }

  if (phase === "coordinator_check") return ["returned_for_correction"];
  if (phase === "management_review") return ["needs_management_review"];
  if (phase === "proofreading") return ["selected_for_proofreading"];
  if (phase === "literary_proofreading") return ["selected_for_proofreading"];
  if (phase === "final_review") return ["proofreading_done"];

  return [];
}

function normalizeSchoolName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function schoolKeyFromSubmission(submission: {
  institution_ref_number?: string | null;
  institution_name?: string | null;
}) {
  const institutionRef = String(submission?.institution_ref_number ?? "").trim();
  if (institutionRef) return `ref:${institutionRef.toLowerCase()}`;

  const institutionName = normalizeSchoolName(submission?.institution_name);
  if (institutionName) return `name:${institutionName}`;

  return "unknown_school";
}

function isLiteraryPathway(
  pathway: string | null | undefined,
  _subpathway?: string | null | undefined,
  pathwayAr?: string | null | undefined,
  _subpathwayAr?: string | null | undefined
) {
  // Literary proofreading is required only for the main pathway
  // "Literary Expressions". Do not infer it from subpathway text.
  const pathwayEn = String(pathway ?? "").trim().toLowerCase();
  const pathwayArabic = String(pathwayAr ?? "").trim().toLowerCase();

  return (
    pathwayEn === "literary expressions" ||
    pathwayArabic === "التعبيرات الأدبية" ||
    pathwayArabic === "التعبيرات الادبية"
  );
}

function literaryProofreaderTypeForSubmission(
  submission: Pick<SubmissionForAssignment, "literary_language" | "reference_id" | "id">
): ProofreaderType {
  if (submission.literary_language === "arabic") return "literary_arabic";
  if (submission.literary_language === "english_or_others") {
    return "literary_english_or_others";
  }

  throw new Error(
    `${
      submission.reference_id ?? submission.id
    }: Literary language is not classified yet. Admin must set Arabic or English/Others before literary proofreading can be assigned.`
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
      `No active ${
        options?.proofreaderType ? `${options.proofreaderType} ` : ""
      }${role} users available.`
    );
  }

  const userIds = users.map((user) => user.id);

  const workload = new Map<string, number>();
  for (const user of users) {
    workload.set(user.id, 0);
  }

  for (const chunk of chunkArray(userIds, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
    if (!chunk.length) continue;

    const assignments = await fetchAllRows<{ assigned_to: string | null }>((from, to) => {
      let query = supabaseAdmin
        .from("assignments")
        .select("assigned_to")
        .in("assigned_to", chunk)
        .in("status", workloadAssignmentStatuses)
        .range(from, to);

      if (options?.phase) query = query.eq("phase", options.phase);

      if (options?.proofreaderType) {
        query = query.eq("proofreader_type", options.proofreaderType);
      }

      return query;
    });

    for (const row of assignments) {
      if (!row.assigned_to) continue;
      workload.set(row.assigned_to, (workload.get(row.assigned_to) ?? 0) + 1);
    }
  }

  return Array.from(workload.entries()).sort((a, b) => a[1] - b[1])[0][0];
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

  const activeCoordinatorIds = new Set(
    coordinators.map((coordinator) => coordinator.id)
  );

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
      .in("status", activeAssignmentStatuses)
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  for (const assignment of existingSchoolAssignments ?? []) {
    const assignedSchoolKey = schoolKeyFromSubmission(
      assignment?.submissions ?? {}
    );

    if (
      assignedSchoolKey === schoolKey &&
      assignment.assigned_to &&
      activeCoordinatorIds.has(assignment.assigned_to)
    ) {
      return assignment.assigned_to;
    }
  }

  return getLeastLoadedUser("coordinator", {
    phase: "coordinator_check",
  });
}

async function getAssignmentById(assignmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("assignments")
    .select(
      "id,submission_id,phase,status,assigned_to,proofreader_type,correction_source_phase,correction_source_assignment_id"
    )
    .eq("id", assignmentId)
    .single();

  if (error) throw error;
  return data;
}

async function cancelDuplicateActiveAssignmentsForSource(
  sourceAssignment: {
    id: string;
    submission_id: string;
    phase: WorkflowPhase;
    proofreader_type?: ProofreaderType | null;
  },
  actorId?: string
) {
  let query = supabaseAdmin
    .from("assignments")
    .update({
      status: "cancelled",
      decision: "cancelled_duplicate_return",
      completed_at: null,
      updated_at: new Date().toISOString(),
      assigned_by: actorId ?? null,
    })
    .eq("submission_id", sourceAssignment.submission_id)
    .eq("phase", sourceAssignment.phase)
    .neq("id", sourceAssignment.id)
    .in("status", activeAssignmentStatuses);

  if (sourceAssignment.phase === "proofreading") {
    query = query.eq("proofreader_type", sourceAssignment.proofreader_type ?? "general");
  }

  if (sourceAssignment.phase === "literary_proofreading" && sourceAssignment.proofreader_type) {
    query = query.eq("proofreader_type", sourceAssignment.proofreader_type);
  }

  const { error } = await query;
  if (error) throw error;
}

function activeAssignmentMatchDescription(
  phase: WorkflowPhase,
  proofreaderType?: ProofreaderType | null
) {
  if (phase === "proofreading") {
    return proofreaderType ? ` for ${proofreaderType}` : " for general proofreading";
  }

  if (phase === "literary_proofreading") {
    return proofreaderType ? ` for ${proofreaderType}` : " for literary proofreading";
  }

  return "";
}

async function cancelStaleCoordinatorTasksForSource(
  submissionId: string,
  sourceAssignmentId: string,
  actorId?: string
) {
  const timestamp = new Date().toISOString();
  const updateValues = {
    status: "cancelled",
    decision: "cancelled_replaced_by_new_correction_source",
    completed_at: timestamp,
    updated_at: timestamp,
    assigned_by: actorId ?? null,
  };

  const { error } = await supabaseAdmin
    .from("assignments")
    .update(updateValues)
    .eq("submission_id", submissionId)
    .eq("phase", "coordinator_check")
    .in("status", ["assigned", "in_progress"])
    .neq("correction_source_assignment_id", sourceAssignmentId);

  if (error) throw error;

  const { error: nullSourceError } = await supabaseAdmin
    .from("assignments")
    .update(updateValues)
    .eq("submission_id", submissionId)
    .eq("phase", "coordinator_check")
    .in("status", ["assigned", "in_progress"])
    .is("correction_source_assignment_id", null);

  if (nullSourceError) throw nullSourceError;
}

async function getActiveCorrectionSourceForSubmission(submissionId: string) {
  const { data, error } = await supabaseAdmin
    .from("assignments")
    .select(
      "id,submission_id,phase,status,decision,assigned_to,correction_reason,correction_notes"
    )
    .eq("submission_id", submissionId)
    .eq("status", "returned_for_correction")
    .eq("decision", "needs_correction")
    .neq("phase", "coordinator_check")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
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
  if (phase === "coordinator_check" && options?.correctionSourceAssignmentId) {
    await cancelStaleCoordinatorTasksForSource(
      submissionId,
      options.correctionSourceAssignmentId,
      actorId
    );
  }

  let existingQuery = supabaseAdmin
    .from("assignments")
    .select("id,status,assigned_to,proofreader_type,correction_source_assignment_id")
    .eq("submission_id", submissionId)
    .eq("phase", phase)
    .in("status", activeAssignmentStatuses)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (phase === "proofreading") {
    existingQuery = existingQuery.eq(
      "proofreader_type",
      options?.proofreaderType ?? "general"
    );
  }

  if (phase === "literary_proofreading" && options?.proofreaderType) {
    existingQuery = existingQuery.eq("proofreader_type", options.proofreaderType);
  }

  if (phase === "coordinator_check" && options?.correctionSourceAssignmentId) {
    existingQuery = existingQuery.eq(
      "correction_source_assignment_id",
      options.correctionSourceAssignmentId
    );
  }

  const existing = await existingQuery.maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data) {
    return {
      id: existing.data.id,
      skipped: true,
      reason: `Already has an active ${phase} task${activeAssignmentMatchDescription(
        phase,
        options?.proofreaderType
      )}.`,
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
      correction_source_assignment_id:
        options?.correctionSourceAssignmentId ?? null,
      proofreader_type: options?.proofreaderType ?? null,
      status: "assigned",
    })
    .select("id")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    skipped: false,
    assigned_to: assignedTo,
  };
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
  const sourceAssignment = await getAssignmentById(assignmentId);

  await cancelDuplicateActiveAssignmentsForSource(
    {
      id: sourceAssignment.id,
      submission_id: sourceAssignment.submission_id,
      phase: sourceAssignment.phase as WorkflowPhase,
      proofreader_type: sourceAssignment.proofreader_type as ProofreaderType | null,
    },
    actorId
  );

  const updateValues: Record<string, any> = {
    status: "assigned",
    decision: null,
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
    .select("id,assigned_to,phase,status,decision,submission_id")
    .single();

  if (error) throw error;

  return data;
}

async function hasAnyPhaseAssignment(submissionId: string, phase: WorkflowPhase) {
  const { count, error } = await supabaseAdmin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("phase", phase)
    .neq("status", "cancelled");

  if (error) throw error;

  return (count ?? 0) > 0;
}

async function hasActivePhaseAssignment(
  submissionId: string,
  phase: WorkflowPhase
) {
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
  // This count is used by the Admin workflow maintenance card labeled
  // "Unassigned artworks waiting for ADEK evaluation". It must count only
  // submissions that are actually ready for ADEK and have no active ADEK
  // evaluator assignment. Do not include completed, disqualified,
  // proofreading, management-review, or returned-for-correction submissions.
  const submissions = await fetchAllRows<{ id: string }>((from, to) =>
    supabaseAdmin
      .from("submissions")
      .select("id")
      .eq("workflow_status", "ready_for_adek")
      .range(from, to)
  );

  const submissionIds = submissions.map((row) => row.id).filter(Boolean);
  if (!submissionIds.length) return 0;

  const activeAssignmentSubmissionIds = new Set<string>();

  for (const chunk of chunkArray(
    submissionIds,
    SUPABASE_IN_FILTER_CHUNK_SIZE
  )) {
    const assignments = await fetchAllRows<{
      submission_id: string | null;
    }>((from, to) =>
      supabaseAdmin
        .from("assignments")
        .select("submission_id")
        .eq("phase", "adek_evaluation")
        .in("submission_id", chunk)
        .in("status", activeAssignmentStatuses)
        .range(from, to)
    );

    for (const row of assignments) {
      if (row.submission_id) {
        activeAssignmentSubmissionIds.add(row.submission_id);
      }
    }
  }

  return submissionIds.filter((id) => !activeAssignmentSubmissionIds.has(id))
    .length;
}

export async function getEvaluatorAssignmentWorkloads() {
  const evaluators = await fetchAllRows<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>((from, to) =>
    supabaseAdmin
      .from("profiles")
      .select("id,full_name,email")
      .eq("role", "evaluator")
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .range(from, to)
  );

  const evaluatorIds = evaluators.map((evaluator) => evaluator.id);

  const workload = new Map<
    string,
    {
      total: Set<string>;
      remaining: Set<string>;
      sent_for_correction: Set<string>;
      completed: Set<string>;
    }
  >();

  for (const id of evaluatorIds) {
    workload.set(id, {
      total: new Set(),
      remaining: new Set(),
      sent_for_correction: new Set(),
      completed: new Set(),
    });
  }

  for (const chunk of chunkArray(
    evaluatorIds,
    SUPABASE_IN_FILTER_CHUNK_SIZE
  )) {
    if (!chunk.length) continue;

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
        .in("assigned_to", chunk)
        .range(from, to)
    );

    for (const assignment of assignments) {
      if (
        !assignment.assigned_to ||
        !assignment.submission_id ||
        isCancelledStatus(assignment.status)
      ) {
        continue;
      }

      const row = workload.get(assignment.assigned_to);
      if (!row) continue;

      row.total.add(assignment.submission_id);

      if (assignment.status === "completed" && assignment.completed_at) {
        row.completed.add(assignment.submission_id);
      }

      if (assignment.status === "returned_for_correction") {
        row.sent_for_correction.add(assignment.submission_id);
      }

      if (isRemainingAssignmentStatus(assignment.status)) {
        row.remaining.add(assignment.submission_id);
      }
    }
  }

  return evaluators.map((evaluator) => {
    const row = workload.get(evaluator.id);

    return {
      ...evaluator,
      assigned_total: row?.total.size ?? 0,
      remaining: row?.remaining.size ?? 0,
      sent_for_correction: row?.sent_for_correction.size ?? 0,
      completed: row?.completed.size ?? 0,
    };
  });
}

export async function assignAdekToEvaluatorQuantities(
  targets: EvaluatorAssignmentTarget[],
  actorId?: string
) {
  const cleanedTargets = targets
    .map((target) => ({
      evaluatorId: target.evaluatorId,
      quantity: Math.max(0, Math.floor(Number(target.quantity) || 0)),
    }))
    .filter((target) => target.evaluatorId && target.quantity > 0);

  if (!cleanedTargets.length) {
    throw new Error("Enter at least one evaluator quantity greater than zero.");
  }

  const evaluatorIds = Array.from(
    new Set(cleanedTargets.map((target) => target.evaluatorId))
  );

  const { data: evaluators, error: evaluatorsError } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,email")
    .eq("role", "evaluator")
    .eq("is_active", true)
    .in("id", evaluatorIds);

  if (evaluatorsError) throw evaluatorsError;

  const validEvaluatorIds = new Set(
    (evaluators ?? []).map((evaluator) => evaluator.id)
  );

  const invalidTargets = evaluatorIds.filter((id) => !validEvaluatorIds.has(id));

  if (invalidTargets.length) {
    throw new Error("One or more selected evaluators are inactive or invalid.");
  }

  const totalRequested = cleanedTargets.reduce(
    (sum, target) => sum + target.quantity,
    0
  );

  const submissions = await fetchAllRows<{
    id: string;
    reference_id: string | null;
    created_at: string | null;
  }>((from, to) =>
    supabaseAdmin
      .from("submissions")
      .select("id,reference_id,created_at")
      .eq("registration_status", "Submitted")
      .order("created_at", { ascending: true })
      .order("reference_id", { ascending: true })
      .range(from, to)
  );

  const submissionIds = submissions
    .map((submission) => submission.id)
    .filter(Boolean);

  const alreadyAssigned = new Set<string>();

  for (const chunk of chunkArray(
    submissionIds,
    SUPABASE_IN_FILTER_CHUNK_SIZE
  )) {
    if (!chunk.length) continue;

    const assignments = await fetchAllRows<{
      submission_id: string | null;
      status: string | null;
    }>((from, to) =>
      supabaseAdmin
        .from("assignments")
        .select("submission_id,status")
        .eq("phase", "adek_evaluation")
        .in("submission_id", chunk)
        .range(from, to)
    );

    for (const row of assignments) {
      if (row.submission_id && !isCancelledStatus(row.status)) {
        alreadyAssigned.add(row.submission_id);
      }
    }
  }

  const availableSubmissions = submissions.filter(
    (submission) => !alreadyAssigned.has(submission.id)
  );

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
    const ids = assignmentsToInsert.map(
      (assignment) => assignment.submission_id
    );

    for (const chunk of chunkArray(ids, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { error } = await supabaseAdmin
        .from("submissions")
        .update({
          workflow_status: "ready_for_adek",
          updated_at: new Date().toISOString(),
        })
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
      assigned: assignmentsToInsert.filter(
        (assignment) => assignment.assigned_to === target.evaluatorId
      ).length,
    })),
  };
}

export async function autoAssignPending(
  phase: WorkflowPhase,
  limit = 5000,
  actorId?: string
) {
  if (phase === "adek_evaluation") {
    throw new Error(
      "ADEK evaluator assignments must be created from Admin Dashboard using evaluator quantities."
    );
  }

  const eligibleStatuses = eligibleStatusForPhase(phase);

  const submissions = await fetchAllRows<SubmissionForAssignment>((from, to) =>
    supabaseAdmin
      .from("submissions")
      .select(
        "id,reference_id,workflow_status,registration_status,art_pathway_name_en,art_pathway_name_ar,art_sub_pathway_name_en,art_sub_pathway_name_ar,literary_language"
      )
      .in("workflow_status", eligibleStatuses)
      .range(from, to)
  );

  const limitedSubmissions = submissions.slice(0, limit);

  let assigned = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const submission of limitedSubmissions) {
    try {
      let proofreaderType: ProofreaderType | undefined;
      let assignmentOptions: Parameters<typeof autoAssignOne>[3] = {};

      if (phase === "coordinator_check") {
        const sourceAssignment = await getActiveCorrectionSourceForSubmission(
          submission.id
        );

        if (!sourceAssignment) {
          skipped++;
          errors.push(
            `${submission.reference_id ?? submission.id}: Returned for correction but no active source assignment was found.`
          );
          continue;
        }

        assignmentOptions = {
          requestedByUserId: sourceAssignment.assigned_to ?? null,
          returnToUserId: sourceAssignment.assigned_to ?? null,
          correctionReason: sourceAssignment.correction_reason ?? null,
          correctionNotes: sourceAssignment.correction_notes ?? null,
          correctionSourcePhase: sourceAssignment.phase as WorkflowPhase,
          correctionSourceAssignmentId: sourceAssignment.id,
        };
      } else if (await hasActivePhaseAssignment(submission.id, phase)) {
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

        if (
          submission.literary_language !== "arabic" &&
          submission.literary_language !== "english_or_others"
        ) {
          skipped++;
          errors.push(
            `${
              submission.reference_id ?? submission.id
            }: Literary language is not classified yet.`
          );
          continue;
        }

        proofreaderType = literaryProofreaderTypeForSubmission(submission);
      }

      if (phase === "management_review") {
        if (await hasActivePhaseAssignment(submission.id, "management_review")) {
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
        ...assignmentOptions,
        proofreaderType,
      });

      if (result.skipped) skipped++;
      else assigned++;
    } catch (error: any) {
      skipped++;
      errors.push(
        `${submission.reference_id ?? submission.id}: ${
          error?.message ?? "Assignment failed"
        }`
      );
    }
  }

  return {
    phase,
    eligible: limitedSubmissions.length,
    assigned,
    skipped,
    errors,
  };
}

export async function assignAdekAfterImport(
  _submissionId: string,
  _actorId?: string
) {
  return {
    skipped: true,
    reason: "Imports no longer auto-assign ADEK evaluator tasks.",
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
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

  const generalAlreadyExists = await hasAnyPhaseAssignment(
    submissionId,
    "proofreading"
  );

  const general = generalAlreadyExists
    ? {
        skipped: true,
        reason: "General proofreading task already exists.",
      }
    : await autoAssignOne(submissionId, "proofreading", actorId, {
        proofreaderType: "general",
      });

  let literary:
    | Awaited<ReturnType<typeof autoAssignOne>>
    | { skipped: boolean; reason: string }
    | null = null;

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

      const literaryAlreadyExists = await hasAnyPhaseAssignment(
        submissionId,
        "literary_proofreading"
      );

      literary = literaryAlreadyExists
        ? {
            skipped: true,
            reason: "Literary proofreading task already exists.",
          }
        : await autoAssignOne(submissionId, "literary_proofreading", actorId, {
            proofreaderType,
          });
    } else {
      literarySkippedReason =
        "Literary language is not classified yet. General proofreading was assigned. Literary proofreading will be assigned after Admin classifies the language.";
    }
  }

  return {
    general,
    literary,
    literarySkippedReason,
  };
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
    .select(
      "art_pathway_name_en,art_pathway_name_ar,art_sub_pathway_name_en,art_sub_pathway_name_ar,literary_language"
    )
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

async function isLiteraryReady(submissionId: string) {
  const { data: submission, error } = await supabaseAdmin
    .from("submissions")
    .select(
      "id,reference_id,art_pathway_name_en,art_pathway_name_ar,art_sub_pathway_name_en,art_sub_pathway_name_ar,literary_language,literary_management_approved_at"
    )
    .eq("id", submissionId)
    .single();

  if (error) throw error;

  if (
    !isLiteraryPathway(
      submission?.art_pathway_name_en,
      submission?.art_sub_pathway_name_en,
      submission?.art_pathway_name_ar,
      submission?.art_sub_pathway_name_ar
    )
  ) {
    return true;
  }

  if (submission?.literary_management_approved_at) return true;

  if (
    submission.literary_language !== "arabic" &&
    submission.literary_language !== "english_or_others"
  ) {
    return false;
  }

  const proofreaderType = literaryProofreaderTypeForSubmission(submission);

  const { count, error: assignmentError } = await supabaseAdmin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("phase", "literary_proofreading")
    .eq("proofreader_type", proofreaderType)
    .eq("status", "completed")
    .not("completed_at", "is", null);

  if (assignmentError) throw assignmentError;

  return (count ?? 0) > 0;
}

export async function isReadyForFinalReview(submissionId: string) {
  const adekDone = await hasCompletedPhase(submissionId, "adek_evaluation");
  const generalDone = await hasCompletedPhase(submissionId, "proofreading");
  const literaryDone = await isLiteraryReady(submissionId);
  const activeCorrection = await hasActivePhase(
    submissionId,
    "coordinator_check"
  );
  const activeManagement = await hasPendingManagementReview(submissionId);

  return adekDone && generalDone && literaryDone && !activeCorrection && !activeManagement;
}

async function getReviewerForProofreader(generalProofreaderId: string) {
  const { data: links, error } = await supabaseAdmin
    .from("reviewer_proofreader_links")
    .select("reviewer_id")
    .eq("proofreader_id", generalProofreaderId);

  if (error) throw error;

  const linkedReviewerIds = (links ?? [])
    .map((row) => row.reviewer_id)
    .filter(Boolean);

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
    return {
      assigned: false,
      waiting_for: "previous_stages",
    };
  }

  if (await hasAnyPhaseAssignment(submissionId, "final_review")) {
    return {
      assigned: false,
      waiting_for: "already_has_final_review",
    };
  }

  const assignedTo = await getReviewerForProofreader(generalProofreaderId);

  const result = await autoAssignOne(submissionId, "final_review", actorId, {
    assignedTo,
    requestedByUserId: generalProofreaderId,
  });

  await supabaseAdmin
    .from("submissions")
    .update({
      workflow_status: "proofreading_done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  return {
    assigned: !result.skipped,
    reviewer_id: assignedTo,
    result,
  };
}

async function getCompletedGeneralProofreaderId(submissionId: string) {
  const { data, error } = await supabaseAdmin
    .from("assignments")
    .select("assigned_to")
    .eq("submission_id", submissionId)
    .eq("phase", "proofreading")
    .eq("proofreader_type", "general")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`General proofreader lookup failed: ${error.message}`);
  }

  return data?.assigned_to ?? null;
}

async function repairCoordinatorCorrections(actorId?: string) {
  return autoAssignPending("coordinator_check", 5000, actorId);
}

async function repairManagementReview(actorId?: string) {
  return autoAssignPending("management_review", 5000, actorId);
}

async function repairGeneralProofreading(actorId?: string) {
  return autoAssignPending("proofreading", 5000, actorId);
}

async function repairLiteraryProofreading(actorId?: string) {
  return autoAssignPending("literary_proofreading", 5000, actorId);
}

async function repairFinalReview(actorId?: string) {
  return autoAssignPending("final_review", 5000, actorId);
}

export type RepairMissingAssignmentsScope =
  | "all"
  | "coordinator_check"
  | "management_review"
  | "proofreading"
  | "literary_proofreading"
  | "final_review";

export async function repairMissingAssignments(
  actorId?: string,
  scope: RepairMissingAssignmentsScope = "all"
) {
  const results: any[] = [];

  if (scope === "all" || scope === "coordinator_check") {
    results.push(await repairCoordinatorCorrections(actorId));
  }

  if (scope === "all" || scope === "management_review") {
    results.push(await repairManagementReview(actorId));
  }

  if (scope === "all" || scope === "proofreading") {
    results.push(await repairGeneralProofreading(actorId));
  }

  if (scope === "all" || scope === "literary_proofreading") {
    results.push(await repairLiteraryProofreading(actorId));
  }

  if (scope === "all" || scope === "final_review") {
    results.push(await repairFinalReview(actorId));
  }

  const assigned = results.reduce((sum, row) => sum + (row.assigned ?? 0), 0);
  const skipped = results.reduce((sum, row) => sum + (row.skipped ?? 0), 0);
  const errors = results.flatMap((row) => row.errors ?? []);

  return {
    scope,
    assigned,
    skipped,
    errors,
    phases: results,
  };
}

export async function repairMissingAdekAssignments(
  submissionIds: string[],
  actorId?: string
) {
  const uniqueSubmissionIds = Array.from(new Set(submissionIds.filter(Boolean)));

  if (!uniqueSubmissionIds.length) {
    return {
      assigned: 0,
      skipped: 0,
    };
  }

  const { data: evaluators, error: evaluatorsError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("role", "evaluator")
    .eq("is_active", true);

  if (evaluatorsError) throw evaluatorsError;

  const evaluatorIds = (evaluators ?? []).map((row) => row.id);

  if (!evaluatorIds.length) {
    throw new Error("No active evaluator users available.");
  }

  const { data: activeAssignments, error: activeError } = await supabaseAdmin
    .from("assignments")
    .select("assigned_to")
    .eq("phase", "adek_evaluation")
    .in("assigned_to", evaluatorIds)
    .in("status", activeAssignmentStatuses);

  if (activeError) throw activeError;

  const workload = new Map<string, number>();

  for (const evaluatorId of evaluatorIds) {
    workload.set(evaluatorId, 0);
  }

  for (const row of activeAssignments ?? []) {
    workload.set(row.assigned_to, (workload.get(row.assigned_to) ?? 0) + 1);
  }

  const alreadyAssigned = new Set<string>();

  for (const submissionChunk of chunkArray(
    uniqueSubmissionIds,
    SUPABASE_IN_FILTER_CHUNK_SIZE
  )) {
    const { data, error } = await supabaseAdmin
      .from("assignments")
      .select("submission_id")
      .in("submission_id", submissionChunk)
      .eq("phase", "adek_evaluation")
      .in("status", activeAssignmentStatuses);

    if (error) throw error;

    for (const row of data ?? []) {
      alreadyAssigned.add(row.submission_id);
    }
  }

  const assignmentsToInsert: any[] = [];

  for (const submissionId of uniqueSubmissionIds) {
    if (alreadyAssigned.has(submissionId)) continue;

    const assignedTo = Array.from(workload.entries()).sort(
      (a, b) => a[1] - b[1]
    )[0][0];

    workload.set(assignedTo, (workload.get(assignedTo) ?? 0) + 1);

    assignmentsToInsert.push({
      submission_id: submissionId,
      phase: "adek_evaluation",
      assigned_to: assignedTo,
      assigned_by: actorId ?? null,
      status: "assigned",
    });
  }

  for (const assignmentChunk of chunkArray(assignmentsToInsert, 500)) {
    const { error } = await supabaseAdmin
      .from("assignments")
      .insert(assignmentChunk);

    if (error) throw error;
  }

  return {
    assigned: assignmentsToInsert.length,
    skipped: uniqueSubmissionIds.length - assignmentsToInsert.length,
  };
}

export async function createAssignmentBatch(
  phase: WorkflowPhase,
  actorId: string
) {
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
    .select(
      "id,phase,status,current_step,eligible_count,processed_count,assigned_count,skipped_count,error_count,error_message,started_by,started_at,completed_at,created_at"
    )
    .eq("id", batchId)
    .single();

  if (error) throw error;

  const { data: errors } = await supabaseAdmin
    .from("assignment_batch_errors")
    .select("reference_id,error_message,created_at")
    .eq("assignment_batch_id", batchId)
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    ...data,
    recent_errors: errors ?? [],
  };
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

    if (phase === "adek_evaluation") {
      try {
        await supabaseAdmin.rpc("normalize_submitted_workflow_statuses");
      } catch (normalizeError: any) {
        throw new Error(
          `Could not prepare submitted artworks for ADEK assignment: ${normalizeError.message}`
        );
      }
    }

    const result = await autoAssignPending(phase, limit, actorId);

    if (result.errors.length > 0) {
      for (const errorChunk of chunkArray(result.errors, 500)) {
        const { error } = await supabaseAdmin
          .from("assignment_batch_errors")
          .insert(
            errorChunk.map((message) => ({
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