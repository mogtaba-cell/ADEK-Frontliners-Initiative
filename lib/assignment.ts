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

function eligibleStatusForPhase(phase: WorkflowPhase) {
  if (phase === "adek_evaluation") return ["ready_for_adek", "coordinator_pending"];
  if (phase === "coordinator_check") return ["returned_for_correction"];
  if (phase === "management_review") return ["needs_management_review"];
  if (phase === "proofreading") return ["selected_for_proofreading", "returned_for_correction"];
  if (phase === "literary_proofreading") return ["selected_for_proofreading"];
  if (phase === "final_review") return ["proofreading_done"];
  return [];
}

function isLiteraryPathway(pathway: string | null | undefined) {
  return String(pathway ?? "").toLowerCase().includes("literary");
}

async function getActiveUsers(role: Role, options?: { proofreaderType?: ProofreaderType }) {
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
  let users = await getActiveUsers(role, { proofreaderType: options?.proofreaderType });

  if (options?.candidateIds?.length) {
    const candidates = new Set(options.candidateIds);
    users = users.filter((user) => candidates.has(user.id));
  }

  if (!users.length) {
    throw new Error(`No active ${options?.proofreaderType ? `${options.proofreaderType} ` : ""}${role} users available.`);
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
  for (const user of users) workload.set(user.id, 0);

  for (const row of activeAssignments ?? []) {
    workload.set(row.assigned_to, (workload.get(row.assigned_to) ?? 0) + 1);
  }

  return Array.from(workload.entries()).sort((a, b) => a[1] - b[1])[0][0];
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
    return { id: existing.data.id, skipped: true, reason: "Already assigned for this phase." };
  }

  const role = phaseToRole[phase];
  const assignedTo = options?.assignedTo ?? (await getLeastLoadedUser(role, { proofreaderType: options?.proofreaderType }));

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

  return { id: data.id, skipped: false, assigned_to: assignedTo };
}

export async function autoAssignPending(phase: WorkflowPhase, limit = 500, actorId?: string) {
  const eligibleStatuses = eligibleStatusForPhase(phase);

  let query = supabaseAdmin
    .from("submissions")
    .select("id,reference_id,workflow_status,registration_status,art_pathway_name_en")
    .limit(limit);

  if (phase === "adek_evaluation") {
    query = query.eq("registration_status", "Submitted").in("workflow_status", eligibleStatuses);
  } else if (phase === "literary_proofreading") {
    query = query.in("workflow_status", eligibleStatuses).ilike("art_pathway_name_en", "%Literary%");
  } else {
    query = query.in("workflow_status", eligibleStatuses);
  }

  const { data: submissions, error } = await query;
  if (error) throw error;

  let assigned = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const submission of submissions ?? []) {
    try {
      const proofreaderType = phase === "proofreading" ? "general" : phase === "literary_proofreading" ? "literary" : undefined;
      const result = await autoAssignOne(submission.id, phase, actorId, { proofreaderType });
      if (result.skipped) skipped++;
      else assigned++;
    } catch (error: any) {
      skipped++;
      errors.push(`${submission.reference_id ?? submission.id}: ${error?.message ?? "Assignment failed"}`);
    }
  }

  return { phase, eligible: submissions?.length ?? 0, assigned, skipped, errors };
}

export async function assignAdekAfterImport(submissionId: string, actorId?: string) {
  return autoAssignOne(submissionId, "adek_evaluation", actorId);
}

export async function assignProofreadingAfterApproval(submissionId: string, actorId?: string) {
  const { data: submission, error } = await supabaseAdmin
    .from("submissions")
    .select("id,art_pathway_name_en")
    .eq("id", submissionId)
    .single();

  if (error) throw error;

  const general = await autoAssignOne(submissionId, "proofreading", actorId, { proofreaderType: "general" });
  let literary: Awaited<ReturnType<typeof autoAssignOne>> | null = null;

  if (isLiteraryPathway(submission?.art_pathway_name_en)) {
    literary = await autoAssignOne(submissionId, "literary_proofreading", actorId, { proofreaderType: "literary" });
  }

  return { general, literary };
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

async function isLiteraryReady(submissionId: string) {
  const { data: submission, error } = await supabaseAdmin
    .from("submissions")
    .select("art_pathway_name_en,literary_management_approved_at")
    .eq("id", submissionId)
    .single();

  if (error) throw error;
  if (!isLiteraryPathway(submission?.art_pathway_name_en)) return true;
  if (submission?.literary_management_approved_at) return true;
  return hasCompletedPhase(submissionId, "literary_proofreading");
}

async function getReviewerForProofreader(generalProofreaderId: string) {
  const { data: links, error } = await supabaseAdmin
    .from("reviewer_proofreader_links")
    .select("reviewer_id")
    .eq("proofreader_id", generalProofreaderId);

  if (error) throw error;

  const linkedReviewerIds = (links ?? []).map((row) => row.reviewer_id).filter(Boolean);
  return getLeastLoadedUser("reviewer", { candidateIds: linkedReviewerIds.length ? linkedReviewerIds : undefined });
}

export async function maybeAssignReviewerAfterProofreading(
  submissionId: string,
  generalProofreaderId: string,
  actorId?: string
) {
  const generalDone = await hasCompletedPhase(submissionId, "proofreading");
  const literaryReady = await isLiteraryReady(submissionId);

  if (!generalDone || !literaryReady) {
    return { assigned: false, waiting_for: !generalDone ? "general_proofreading" : "literary_proofreading" };
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
  limit = 500,
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
      await supabaseAdmin.from("assignment_batch_errors").insert(
        result.errors.map((message) => ({
          assignment_batch_id: batchId,
          reference_id: null,
          error_message: message,
        }))
      );
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
