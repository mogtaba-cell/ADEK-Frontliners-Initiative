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

const activeAssignmentStatuses = ["assigned", "in_progress"];

type SubmissionForAssignment = {
  id: string;
  reference_id?: string | null;
  workflow_status?: string | null;
  registration_status?: string | null;
  art_pathway_name_en?: string | null;
  art_sub_pathway_name_en?: string | null;
  literary_language?: string | null;
};

function eligibleStatusForPhase(phase: WorkflowPhase) {
  if (phase === "adek_evaluation") return ["ready_for_adek", "coordinator_pending"];
  if (phase === "coordinator_check") return ["returned_for_correction"];
  if (phase === "management_review") return ["needs_management_review"];
  if (phase === "proofreading") {
    return ["selected_for_proofreading", "returned_for_correction"];
  }
  if (phase === "literary_proofreading") return ["selected_for_proofreading"];
  if (phase === "final_review") return ["proofreading_done"];
  return [];
}

function isLiteraryPathway(
  pathway: string | null | undefined,
  subpathway?: string | null | undefined
) {
  const combined = `${pathway ?? ""} ${subpathway ?? ""}`.toLowerCase();

  return (
    combined.includes("literary") ||
    combined.includes("الأدبية") ||
    combined.includes("ادبية")
  );
}

function literaryProofreaderTypeForSubmission(
  submission: Pick<
    SubmissionForAssignment,
    "literary_language" | "reference_id" | "id"
  >
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

async function getActiveUsers(
  role: Role,
  options?: { proofreaderType?: ProofreaderType }
) {
  let query = supabaseAdmin
    .from("profiles")
    .select("id,full_name,role,is_active,proofreader_type")
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

  const { data: activeAssignments, error } = await supabaseAdmin
    .from("assignments")
    .select("assigned_to")
    .in(
      "assigned_to",
      users.map((user) => user.id)
    )
    .in("status", activeAssignmentStatuses);

  if (error) throw error;

  const workload = new Map<string, number>();

  for (const user of users) {
    workload.set(user.id, 0);
  }

  for (const row of activeAssignments ?? []) {
    workload.set(row.assigned_to, (workload.get(row.assigned_to) ?? 0) + 1);
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

  const coordinatorIds = new Set(coordinators.map((coordinator) => coordinator.id));

  const { data: existingSchoolAssignments, error: existingError } =
    await supabaseAdmin
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
      .in("status", ["assigned", "in_progress", "completed"])
      .order("created_at", { ascending: false });

  if (existingError) throw existingError;

  for (const assignment of existingSchoolAssignments ?? []) {
    const assignedSchoolKey = schoolKeyFromSubmission(
      (assignment as any).submissions ?? {}
    );

    if (
      assignedSchoolKey === schoolKey &&
      assignment.assigned_to &&
      coordinatorIds.has(assignment.assigned_to)
    ) {
      return assignment.assigned_to;
    }
  }

  return getLeastLoadedUser("coordinator");
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
  }
) {
  const existing = await supabaseAdmin
    .from("assignments")
    .select("id")
    .eq("submission_id", submissionId)
    .eq("phase", phase)
    .in("status", activeAssignmentStatuses)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data) {
    return {
      id: existing.data.id,
      skipped: true,
      reason: "Already assigned for this phase.",
    };
  }

  const role = phaseToRole[phase];

  let assignedTo = options?.assignedTo;

  if (!assignedTo && phase === "coordinator_check") {
    assignedTo = await getCoordinatorForSchool(submissionId);
  }

  if (!assignedTo) {
    assignedTo = await getLeastLoadedUser(role, {
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

export async function autoAssignPending(
  phase: WorkflowPhase,
  limit = 5000,
  actorId?: string
) {
  const eligibleStatuses = eligibleStatusForPhase(phase);

  let query = supabaseAdmin
    .from("submissions")
    .select(
      "id,reference_id,workflow_status,registration_status,art_pathway_name_en,art_sub_pathway_name_en,literary_language"
    )
    .limit(limit);

  if (phase === "adek_evaluation") {
    query = query
      .eq("registration_status", "Submitted")
      .in("workflow_status", eligibleStatuses);
  } else if (phase === "literary_proofreading") {
    query = query
      .in("workflow_status", eligibleStatuses)
      .or(
        [
          "art_pathway_name_en.ilike.%Literary%",
          "art_sub_pathway_name_en.ilike.%Literary%",
          "art_pathway_name_ar.ilike.%الأدبية%",
          "art_sub_pathway_name_ar.ilike.%الأدبية%",
        ].join(",")
      );
  } else {
    query = query.in("workflow_status", eligibleStatuses);
  }

  const { data: submissions, error } = await query;

  if (error) throw error;

  let assigned = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const submission of (submissions ?? []) as SubmissionForAssignment[]) {
    try {
      let proofreaderType: ProofreaderType | undefined;

      if (phase === "proofreading") {
        proofreaderType = "general";
      }

      if (phase === "literary_proofreading") {
        if (
          !isLiteraryPathway(
            submission.art_pathway_name_en,
            submission.art_sub_pathway_name_en
          )
        ) {
          skipped++;
          continue;
        }

        proofreaderType = literaryProofreaderTypeForSubmission(submission);
      }

      const result = await autoAssignOne(submission.id, phase, actorId, {
        proofreaderType,
      });

      if (result.skipped) {
        skipped++;
      } else {
        assigned++;
      }
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
    eligible: submissions?.length ?? 0,
    assigned,
    skipped,
    errors,
  };
}

export async function assignAdekAfterImport(
  submissionId: string,
  actorId?: string
) {
  return autoAssignOne(submissionId, "adek_evaluation", actorId);
}

export async function bulkAssignAdekAfterImport(
  submissionIds: string[],
  actorId?: string
) {
  const uniqueSubmissionIds = Array.from(new Set(submissionIds)).filter(Boolean);

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

  const evaluatorIds = (evaluators ?? []).map((user) => user.id);

  if (!evaluatorIds.length) {
    throw new Error("No active ADEK evaluators available.");
  }

  const { data: activeAssignments, error: activeAssignmentsError } =
    await supabaseAdmin
      .from("assignments")
      .select("assigned_to")
      .in("assigned_to", evaluatorIds)
      .in("status", activeAssignmentStatuses);

  if (activeAssignmentsError) throw activeAssignmentsError;

  const workload = new Map<string, number>();

  for (const evaluatorId of evaluatorIds) {
    workload.set(evaluatorId, 0);
  }

  for (const row of activeAssignments ?? []) {
    workload.set(row.assigned_to, (workload.get(row.assigned_to) ?? 0) + 1);
  }

  const alreadyAssigned = new Set<string>();

  for (const submissionChunk of chunkArray(uniqueSubmissionIds, 500)) {
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
      "id,reference_id,art_pathway_name_en,art_sub_pathway_name_en,literary_language"
    )
    .eq("id", submissionId)
    .single();

  if (error) throw error;

  const general = await autoAssignOne(submissionId, "proofreading", actorId, {
    proofreaderType: "general",
  });

  let literary: Awaited<ReturnType<typeof autoAssignOne>> | null = null;
  let literarySkippedReason: string | null = null;

  if (
    isLiteraryPathway(
      submission?.art_pathway_name_en,
      submission?.art_sub_pathway_name_en
    )
  ) {
    if (
      submission.literary_language === "arabic" ||
      submission.literary_language === "english_or_others"
    ) {
      const proofreaderType = literaryProofreaderTypeForSubmission(submission);

      literary = await autoAssignOne(
        submissionId,
        "literary_proofreading",
        actorId,
        {
          proofreaderType,
        }
      );
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
    .eq("status", "completed");

  if (error) throw error;

  return (count ?? 0) > 0;
}

async function hasCompletedLiteraryProofreadingForLanguage(
  submissionId: string,
  proofreaderType: ProofreaderType
) {
  const { count, error } = await supabaseAdmin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("phase", "literary_proofreading")
    .eq("proofreader_type", proofreaderType)
    .eq("status", "completed");

  if (error) throw error;

  return (count ?? 0) > 0;
}

async function isLiteraryReady(submissionId: string) {
  const { data: submission, error } = await supabaseAdmin
    .from("submissions")
    .select(
      "id,reference_id,art_pathway_name_en,art_sub_pathway_name_en,literary_language,literary_management_approved_at"
    )
    .eq("id", submissionId)
    .single();

  if (error) throw error;

  if (
    !isLiteraryPathway(
      submission?.art_pathway_name_en,
      submission?.art_sub_pathway_name_en
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

  return hasCompletedLiteraryProofreadingForLanguage(
    submissionId,
    proofreaderType
  );
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
    candidateIds: linkedReviewerIds.length ? linkedReviewerIds : undefined,
  });
}

export async function maybeAssignReviewerAfterProofreading(
  submissionId: string,
  generalProofreaderId: string,
  actorId?: string
) {
  const generalDone = await hasCompletedPhase(submissionId, "proofreading");
  const literaryReady = await isLiteraryReady(submissionId);

  if (!generalDone || !literaryReady) {
    return {
      assigned: false,
      waiting_for: !generalDone
        ? "general_proofreading"
        : "literary_proofreading",
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
        current_step: `Preparing ${phase} assignments`,
        started_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    if (phase === "adek_evaluation") {
      const { error: normalizeError } = await supabaseAdmin
        .from("submissions")
        .update({
          workflow_status: "ready_for_adek",
          updated_at: new Date().toISOString(),
        })
        .eq("registration_status", "Submitted")
        .in("workflow_status", ["imported", "coordinator_pending"]);

      if (normalizeError) {
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

        if (error) {
          throw new Error(`Could not save assignment errors: ${error.message}`);
        }
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