import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { audit } from "@/lib/audit";
import {
  assignArtisticRankingAfterCategorization,
  assignCategorizationAfterReview,
  assignProofreadingAfterApproval,
  autoAssignOne,
  maybeAssignReviewerAfterProofreading,
  reactivateAssignmentForReturn,
} from "@/lib/assignment";
import type { WorkflowPhase } from "@/lib/types";
import {
  calculateArtisticRubricTotal,
  finalArtisticRatingFromScore,
  parseRubricScore,
} from "@/lib/rater-rubric";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "assigned",
  "in_progress",
  "returned_for_correction",
  "sent_for_review",
];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nowIso() {
  return new Date().toISOString();
}

function yesNo(value: FormDataEntryValue | null) {
  return String(value ?? "").toLowerCase() === "yes";
}

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  const text = String(value ?? "").trim();
  return text || null;
}

function calculateAdekDecision(a: boolean, b: boolean, c: boolean) {
  if (a && b && c) return "approved";
  if (!a || !c) return "disqualified";
  return "needs_review";
}

function acceptsJson(req: Request) {
  return req.headers.get("accept")?.toLowerCase().includes("application/json") ?? false;
}

function refreshedUrl(req: Request, redirectTo: string) {
  const url = new URL(redirectTo || "/", req.url);
  url.searchParams.set("refresh", Date.now().toString());
  return url;
}

function redirectWithRefresh(req: Request, redirectTo: string) {
  return NextResponse.redirect(refreshedUrl(req, redirectTo), { status: 303 });
}

function successResponse(req: Request, redirectTo: string) {
  const url = refreshedUrl(req, redirectTo);

  if (acceptsJson(req)) {
    return NextResponse.json({
      ok: true,
      message: "Action completed.",
      redirectTo: url.toString(),
    });
  }

  return NextResponse.redirect(url, { status: 303 });
}

async function safeUpdate(
  table: string,
  values: Record<string, any>,
  column: string,
  value: string
) {
  const { error } = await supabaseAdmin
    .from(table)
    .update(values)
    .eq(column, value);

  if (error) {
    throw new Error(`${table} update failed: ${error.message}`);
  }
}

async function addWorkflowComment({
  submissionId,
  authorId,
  phase,
  comment,
}: {
  submissionId: string;
  authorId: string;
  phase: WorkflowPhase;
  comment?: string | null;
}) {
  const text = String(comment ?? "").trim();

  if (!text) return;

  const { error } = await supabaseAdmin.from("comments").insert({
    submission_id: submissionId,
    author_id: authorId,
    phase,
    comment_text: text,
  });

  if (error) {
    throw new Error(`comments insert failed: ${error.message}`);
  }
}

async function getAssignment(assignmentId: string) {
  const { data, error } = await supabaseAdmin
    .from("assignments")
    .select("*")
    .eq("id", assignmentId)
    .single();

  if (error) throw new Error(`Assignment lookup failed: ${error.message}`);
  return data;
}

async function getSubmission(submissionId: string) {
  // Keep this lookup small. The old select("*") included raw_data and long
  // text fields, then wrote them into audit_logs on every task completion.
  // That made POST /api/work/complete slow for large queues.
  const { data, error } = await supabaseAdmin
    .from("submissions")
    .select(
      "id,reference_id,workflow_status,categorized_pathway,categorization_completed_at,artistic_ranking,artistic_ranking_completed_at"
    )
    .eq("id", submissionId)
    .single();

  if (error) throw new Error(`Submission lookup failed: ${error.message}`);
  return data;
}

function editableContentFromForm(form: FormData) {
  return {
    artwork_title_en: textValue(form, "artwork_title_en"),
    artwork_title_ar: textValue(form, "artwork_title_ar"),
    description_en: textValue(form, "description_en"),
    description_ar: textValue(form, "description_ar"),
    influence_idea_source: textValue(form, "influence_idea_source"),
    most_enjoyable_part: textValue(form, "most_enjoyable_part"),
    focused_elements: textValue(form, "focused_elements"),
    updated_at: nowIso(),
  };
}

async function updateEditableContent(submissionId: string, form: FormData) {
  const values = editableContentFromForm(form);

  const hasAnyValue = Object.entries(values).some(
    ([key, value]) => key !== "updated_at" && value !== null
  );

  if (!hasAnyValue) return;

  await safeUpdate("submissions", values, "id", submissionId);
}

async function markAssignmentCompleted(
  assignmentId: string,
  values: Record<string, any> = {}
) {
  const completedAt = values.completed_at ?? nowIso();

  await safeUpdate(
    "assignments",
    {
      status: "completed",
      completed_at: completedAt,
      updated_at: completedAt,
      ...values,
    },
    "id",
    assignmentId
  );
}

async function cancelActiveCoordinatorTasks({
  submissionId,
  keepAssignmentId,
  keepSourceAssignmentId,
  decision = "cancelled_stale_coordinator_task",
  completedAt = nowIso(),
}: {
  submissionId: string;
  keepAssignmentId?: string | null;
  keepSourceAssignmentId?: string | null;
  decision?: string;
  completedAt?: string;
}) {
  const baseUpdate = {
    status: "cancelled",
    decision,
    completed_at: completedAt,
    updated_at: completedAt,
  };

  let query = supabaseAdmin
    .from("assignments")
    .update(baseUpdate)
    .eq("submission_id", submissionId)
    .eq("phase", "coordinator_check")
    .in("status", ["assigned", "in_progress"]);

  if (keepAssignmentId) query = query.neq("id", keepAssignmentId);
  if (keepSourceAssignmentId) {
    query = query.neq("correction_source_assignment_id", keepSourceAssignmentId);
  }

  const { error } = await query;
  if (error) {
    throw new Error(`Coordinator cleanup failed: ${error.message}`);
  }

  if (keepSourceAssignmentId) {
    let nullSourceQuery = supabaseAdmin
      .from("assignments")
      .update(baseUpdate)
      .eq("submission_id", submissionId)
      .eq("phase", "coordinator_check")
      .is("correction_source_assignment_id", null)
      .in("status", ["assigned", "in_progress"]);

    if (keepAssignmentId) nullSourceQuery = nullSourceQuery.neq("id", keepAssignmentId);

    const { error: nullSourceError } = await nullSourceQuery;
    if (nullSourceError) {
      throw new Error(`Coordinator null-source cleanup failed: ${nullSourceError.message}`);
    }
  }
}

async function cancelActiveAssignmentsForCompletedWorkflow({
  submissionId,
  keepAssignmentId,
  completedAt,
}: {
  submissionId: string;
  keepAssignmentId: string;
  completedAt: string;
}) {
  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "cancelled",
      decision: "cancelled_workflow_completed",
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("submission_id", submissionId)
    .neq("id", keepAssignmentId)
    .in("status", ACTIVE_ASSIGNMENT_STATUSES);

  if (error) {
    throw new Error(`Completed workflow cleanup failed: ${error.message}`);
  }
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

  if (error) throw new Error(`General proofreader lookup failed: ${error.message}`);
  return data?.assigned_to ?? null;
}

function workflowStatusForReturnedSource(sourcePhase: WorkflowPhase) {
  if (sourcePhase === "adek_evaluation") return "ready_for_adek";
  if (sourcePhase === "management_review") return "needs_management_review";
  if (sourcePhase === "proofreading" || sourcePhase === "literary_proofreading") {
    return "selected_for_proofreading";
  }
  if (sourcePhase === "final_review") return "proofreading_done";
  if (sourcePhase === "categorization") return "ready_for_categorization";
  if (sourcePhase === "artistic_ranking") return "ready_for_artistic_ranking";
  return "returned_for_correction";
}

async function sendToCoordinatorForCorrection({
  submissionId,
  assignmentId,
  actorId,
  requesterId,
  sourcePhase,
  correctionReason,
  correctionNotes,
}: {
  submissionId: string;
  assignmentId: string;
  actorId: string;
  requesterId: string;
  sourcePhase: WorkflowPhase;
  correctionReason: string;
  correctionNotes?: string | null;
}) {
  const timestamp = nowIso();

  await safeUpdate(
    "assignments",
    {
      status: "returned_for_correction",
      decision: "needs_correction",
      completed_at: null,
      updated_at: timestamp,
      correction_reason: correctionReason,
      correction_notes: correctionNotes ?? null,
    },
    "id",
    assignmentId
  );

  await safeUpdate(
    "submissions",
    {
      workflow_status: "returned_for_correction",
      updated_at: timestamp,
    },
    "id",
    submissionId
  );

  await cancelActiveCoordinatorTasks({
    submissionId,
    keepSourceAssignmentId: assignmentId,
    decision: "cancelled_replaced_by_new_correction_source",
    completedAt: timestamp,
  });

  return autoAssignOne(submissionId, "coordinator_check", actorId, {
    requestedByUserId: requesterId,
    returnToUserId: requesterId,
    correctionReason,
    correctionNotes: correctionNotes ?? null,
    correctionSourcePhase: sourcePhase,
    correctionSourceAssignmentId: assignmentId,
  });
}

async function returnCorrectedSubmission({
  submissionId,
  assignmentId,
  actorId,
}: {
  submissionId: string;
  assignmentId: string;
  actorId: string;
}) {
  const coordinatorAssignment = await getAssignment(assignmentId);
  const sourcePhase = coordinatorAssignment.correction_source_phase as WorkflowPhase | null;

  if (!sourcePhase) {
    throw new Error("Missing correction source phase. Cannot return correction.");
  }

  const sourceAssignmentId = coordinatorAssignment.correction_source_assignment_id as string | null;
  if (!sourceAssignmentId) {
    throw new Error("Missing source assignment. Cannot return correction.");
  }

  const returnToUserId =
    coordinatorAssignment.return_to_user_id ??
    coordinatorAssignment.requested_by_user_id;

  if (!returnToUserId) {
    throw new Error("Missing return user. Cannot return corrected submission.");
  }

  await markAssignmentCompleted(assignmentId, {
    decision: "corrected",
    coordinator_waiting_for_response: false,
    coordinator_waiting_for_response_at: null,
  });

  await reactivateAssignmentForReturn(sourceAssignmentId, actorId, {
    assignedTo: returnToUserId,
    requestedByUserId: actorId,
    correctionReason: coordinatorAssignment.correction_reason ?? null,
    correctionNotes: coordinatorAssignment.correction_notes ?? null,
  });

  await safeUpdate(
    "submissions",
    {
      workflow_status: workflowStatusForReturnedSource(sourcePhase),
      updated_at: nowIso(),
    },
    "id",
    submissionId
  );

  await cancelActiveCoordinatorTasks({
    submissionId,
    keepAssignmentId: assignmentId,
    decision: "cancelled_after_correction_returned",
  });
}


async function reflectManagementDecisionToEvaluatorAssignments({
  submissionId,
  managementDecision,
  timestamp,
}: {
  submissionId: string;
  managementDecision: "approved" | "disqualified";
  timestamp: string;
}) {
  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      decision: managementDecision,
      updated_at: timestamp,
    })
    .eq("submission_id", submissionId)
    .eq("phase", "adek_evaluation")
    .eq("status", "completed")
    .eq("decision", "needs_review");

  if (error) {
    throw new Error(
      `Evaluator management decision reflection failed: ${error.message}`
    );
  }
}

async function resolveManagementSourceAssignment({
  managementAssignment,
  managementDecision,
  actorId,
  timestamp,
  comment,
}: {
  managementAssignment: any;
  managementDecision: "approved" | "disqualified";
  actorId: string;
  timestamp: string;
  comment?: string | null;
}) {
  const sourceAssignmentId =
    managementAssignment?.correction_source_assignment_id as string | null;

  if (!sourceAssignmentId) return;

  const sourcePhase =
    managementAssignment?.correction_source_phase as WorkflowPhase | null;

  if (managementDecision === "approved" && sourcePhase === "literary_proofreading") {
    const returnToUserId =
      managementAssignment.return_to_user_id ??
      managementAssignment.requested_by_user_id;

    if (returnToUserId) {
      await reactivateAssignmentForReturn(sourceAssignmentId, actorId, {
        assignedTo: returnToUserId,
        requestedByUserId: actorId,
        correctionNotes: comment ?? managementAssignment.correction_notes ?? null,
      });
    }

    return;
  }

  const { data: sourceAssignment, error: sourceError } = await supabaseAdmin
    .from("assignments")
    .select("id,phase,status,decision")
    .eq("id", sourceAssignmentId)
    .maybeSingle();

  if (sourceError) {
    throw new Error(`Management source lookup failed: ${sourceError.message}`);
  }

  if (!sourceAssignment) return;

  if (!ACTIVE_ASSIGNMENT_STATUSES.includes(String(sourceAssignment.status))) return;

  if (sourceAssignment.phase === "adek_evaluation") {
    await safeUpdate(
      "assignments",
      {
        status: "completed",
        decision: managementDecision,
        completed_at: timestamp,
        updated_at: timestamp,
      },
      "id",
      sourceAssignment.id
    );
    return;
  }

  if (managementDecision === "approved") {
    await safeUpdate(
      "assignments",
      {
        status: "completed",
        decision: "approved",
        completed_at: timestamp,
        updated_at: timestamp,
      },
      "id",
      sourceAssignment.id
    );
  } else {
    await safeUpdate(
      "assignments",
      {
        status: "cancelled",
        decision: "cancelled_after_management_disqualification",
        completed_at: timestamp,
        updated_at: timestamp,
      },
      "id",
      sourceAssignment.id
    );
  }
}

async function closeOpenAssignmentsAfterDisqualification({
  submissionId,
  currentAssignmentId,
  completedAt,
  sourceAssignmentId,
}: {
  submissionId: string;
  currentAssignmentId: string;
  completedAt: string;
  sourceAssignmentId?: string | null;
}) {
  if (sourceAssignmentId) {
    const { data: sourceAssignment, error: sourceError } = await supabaseAdmin
      .from("assignments")
      .select("id,phase,status")
      .eq("id", sourceAssignmentId)
      .maybeSingle();

    if (sourceError) {
      throw new Error(`Source assignment lookup failed: ${sourceError.message}`);
    }

    if (
      sourceAssignment &&
      ACTIVE_ASSIGNMENT_STATUSES.includes(String(sourceAssignment.status))
    ) {
      if (sourceAssignment.phase === "adek_evaluation") {
        await safeUpdate(
          "assignments",
          {
            status: "completed",
            decision: "disqualified",
            completed_at: completedAt,
            updated_at: completedAt,
          },
          "id",
          sourceAssignment.id
        );
      } else {
        await safeUpdate(
          "assignments",
          {
            status: "cancelled",
            decision: "cancelled_after_disqualification",
            completed_at: completedAt,
            updated_at: completedAt,
          },
          "id",
          sourceAssignment.id
        );
      }
    }
  }

  const { error: evaluatorCloseError } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "completed",
      decision: "disqualified",
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("submission_id", submissionId)
    .eq("phase", "adek_evaluation")
    .neq("id", currentAssignmentId)
    .in("status", ACTIVE_ASSIGNMENT_STATUSES);

  if (evaluatorCloseError) {
    throw new Error(
      `ADEK assignment disqualification cleanup failed: ${evaluatorCloseError.message}`
    );
  }

  const { error: activeCloseError } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "cancelled",
      decision: "cancelled_after_disqualification",
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("submission_id", submissionId)
    .neq("id", currentAssignmentId)
    .in("phase", [
      "coordinator_check",
      "management_review",
      "proofreading",
      "literary_proofreading",
      "final_review",
      "categorization",
      "artistic_ranking",
    ])
    .in("status", ACTIVE_ASSIGNMENT_STATUSES);

  if (activeCloseError) {
    throw new Error(
      `Active assignment disqualification cleanup failed: ${activeCloseError.message}`
    );
  }
}


async function disqualifyFromCoordinator({
  submissionId,
  assignmentId,
  reason,
}: {
  submissionId: string;
  assignmentId: string;
  reason: "no_school_response" | "incomplete_faulty_after_correction";
}) {
  const completedAt = nowIso();
  const coordinatorAssignment = await getAssignment(assignmentId);

  await markAssignmentCompleted(assignmentId, {
    decision: "disqualified",
    correction_reason: reason,
    coordinator_waiting_for_response: false,
    coordinator_waiting_for_response_at: null,
    completed_at: completedAt,
  });

  await safeUpdate(
    "submissions",
    {
      workflow_status: "disqualified",
      disqualification_reason: reason,
      coordinator_disqualification_reason: reason,
      completed_at: completedAt,
      updated_at: completedAt,
    },
    "id",
    submissionId
  );

  await closeOpenAssignmentsAfterDisqualification({
    submissionId,
    currentAssignmentId: assignmentId,
    completedAt,
    sourceAssignmentId: coordinatorAssignment.correction_source_assignment_id ?? null,
  });
}

async function saveCoordinatorProgress({
  assignment,
  assignmentId,
  form,
}: {
  assignment: any;
  assignmentId: string;
  form: FormData;
}) {
  const timestamp = nowIso();
  const comment = textValue(form, "coordinator_comment");
  const waitingForResponse = yesNo(form.get("coordinator_waiting_for_response"));
  const previousWaitingAt = assignment?.coordinator_waiting_for_response_at ?? null;

  await safeUpdate(
    "assignments",
    {
      coordinator_comment: comment,
      coordinator_waiting_for_response: waitingForResponse,
      coordinator_waiting_for_response_at: waitingForResponse
        ? previousWaitingAt ?? timestamp
        : null,
      updated_at: timestamp,
    },
    "id",
    assignmentId
  );
}

async function sendLiteraryToManagementReview({
  submissionId,
  assignmentId,
  actorId,
  requesterId,
  comment,
}: {
  submissionId: string;
  assignmentId: string;
  actorId: string;
  requesterId: string;
  comment?: string | null;
}) {
  const timestamp = nowIso();

  await safeUpdate(
    "assignments",
    {
      status: "sent_for_review",
      decision: "needs_review",
      completed_at: null,
      correction_notes: comment ?? null,
      updated_at: timestamp,
    },
    "id",
    assignmentId
  );

  await safeUpdate(
    "submissions",
    {
      workflow_status: "needs_management_review",
      updated_at: timestamp,
    },
    "id",
    submissionId
  );

  await autoAssignOne(submissionId, "management_review", actorId, {
    requestedByUserId: requesterId,
    returnToUserId: requesterId,
    correctionNotes: comment ?? null,
    correctionSourcePhase: "literary_proofreading",
    correctionSourceAssignmentId: assignmentId,
  });
}

export async function POST(req: Request) {
  let redirectTo = "/";

  try {
    const user = await requireUser([
      "admin",
      "coordinator",
      "evaluator",
      "management",
      "proofreader",
      "reviewer",
      "categorizer",
      "rater",
    ]);

    const form = await req.formData();
    redirectTo = String(form.get("redirect_to") ?? "/");

    const assignmentId = String(form.get("assignment_id") ?? "");
    const submissionId = String(form.get("submission_id") ?? "");
    const phase = String(form.get("phase") ?? "") as WorkflowPhase;

    if (!assignmentId) throw new Error("Missing assignment ID.");
    if (!submissionId) throw new Error("Missing submission ID.");
    if (!phase) throw new Error("Missing workflow phase.");

    const assignment = await getAssignment(assignmentId);
    const submissionBefore = await getSubmission(submissionId);

    const assignmentStatus = String(assignment.status ?? "");
    const submissionWorkflowStatus = String(submissionBefore.workflow_status ?? "");

    if (["completed", "disqualified"].includes(submissionWorkflowStatus)) {
      throw new Error("This artwork workflow is already final.");
    }

    if (!["assigned", "in_progress"].includes(assignmentStatus)) {
      throw new Error("This task is already closed or waiting for correction.");
    }

    if (phase === "adek_evaluation") {
      const taskAction = String(form.get("task_action") ?? "complete");
      const fileQualityClear = yesNo(form.get("adek_file_quality_clear"));
      const evaluatorComment = textValue(form, "evaluator_comment");

      if (taskAction === "send_correction" || !fileQualityClear) {
        await safeUpdate(
          "submissions",
          {
            evaluator_file_quality_clear: false,
            evaluator_comment: evaluatorComment,
            updated_at: nowIso(),
          },
          "id",
          submissionId
        );

        await sendToCoordinatorForCorrection({
          submissionId,
          assignmentId,
          actorId: user.id,
          requesterId: assignment.assigned_to ?? user.id,
          sourcePhase: "adek_evaluation",
          correctionReason: "adek_file_quality",
          correctionNotes: evaluatorComment,
        });
      } else {
        const cultural = yesNo(form.get("cultural_authenticity"));
        const artistic = yesNo(form.get("artistic_excellence"));
        const ethical = yesNo(form.get("ethical_public_appropriateness"));
        const decision = calculateAdekDecision(cultural, artistic, ethical);
        const artisticRating = textValue(form, "artistic_rating");
        const completedAt = nowIso();

        await safeUpdate(
          "submissions",
          {
            evaluator_file_quality_clear: true,
            evaluator_comment: evaluatorComment,
            cultural_authenticity: cultural,
            artistic_excellence: artistic,
            ethical_public_appropriateness: ethical,
            evaluation_decision: decision,
            artistic_rating: artisticRating,
            workflow_status:
              decision === "approved"
                ? "selected_for_proofreading"
                : decision === "needs_review"
                  ? "needs_management_review"
                  : "disqualified",
            completed_at: decision === "disqualified" ? completedAt : null,
            updated_at: completedAt,
          },
          "id",
          submissionId
        );

        await markAssignmentCompleted(assignmentId, {
          decision,
          completed_at: completedAt,
        });

        if (decision === "disqualified") {
          await closeOpenAssignmentsAfterDisqualification({
            submissionId,
            currentAssignmentId: assignmentId,
            completedAt,
          });
        }

        if (decision === "approved") {
          await assignProofreadingAfterApproval(submissionId, user.id);
        }

        if (decision === "needs_review") {
          await autoAssignOne(submissionId, "management_review", user.id, {
            requestedByUserId: user.id,
          });
        }
      }
    }

    if (phase === "coordinator_check") {
      await updateEditableContent(submissionId, form);
      await saveCoordinatorProgress({ assignment, assignmentId, form });

      const coordinatorAction = String(
        form.get("coordinator_action") ?? "return_corrected"
      );

      if (coordinatorAction === "save_progress") {
        // Coordinator saved notes / waiting-for-response status without completing the task.
      } else if (coordinatorAction === "disqualify_no_school_response") {
        await disqualifyFromCoordinator({
          submissionId,
          assignmentId,
          reason: "no_school_response",
        });
      } else if (coordinatorAction === "disqualify_incomplete_faulty") {
        await disqualifyFromCoordinator({
          submissionId,
          assignmentId,
          reason: "incomplete_faulty_after_correction",
        });
      } else {
        await returnCorrectedSubmission({
          submissionId,
          assignmentId,
          actorId: user.id,
        });
      }
    }

    if (phase === "proofreading") {
      await updateEditableContent(submissionId, form);

      const decision = String(form.get("general_proofreader_decision") ?? "ready");

      if (decision === "needs_correction") {
        await sendToCoordinatorForCorrection({
          submissionId,
          assignmentId,
          actorId: user.id,
          requesterId: assignment.assigned_to ?? user.id,
          sourcePhase: "proofreading",
          correctionReason: String(form.get("correction_reason") ?? "incomplete_narrative"),
          correctionNotes: null,
        });
      } else {
        const completedAt = nowIso();

        await safeUpdate(
          "submissions",
          {
            general_proofreading_completed_at: completedAt,
            updated_at: completedAt,
          },
          "id",
          submissionId
        );

        await markAssignmentCompleted(assignmentId, {
          decision: "completed",
          completed_at: completedAt,
        });

        const generalProofreaderId = assignment.assigned_to ?? user.id;
        await maybeAssignReviewerAfterProofreading(
          submissionId,
          generalProofreaderId,
          user.id
        );
      }
    }

    if (phase === "literary_proofreading") {
      const literaryAction = String(form.get("literary_action") ?? "completed");
      const hasPublicationSuitableField = form.has("literary_publication_suitable");
      const publicationSuitable = hasPublicationSuitableField
        ? yesNo(form.get("literary_publication_suitable"))
        : true;
      const literaryUpdatedContent = textValue(form, "literary_updated_content");
      const literaryProofreaderComment = textValue(form, "literary_proofreader_comment");

      await safeUpdate(
        "submissions",
        {
          literary_publication_suitable: publicationSuitable,
          literary_updated_content: literaryUpdatedContent,
          literary_proofreader_comment: literaryProofreaderComment,
          updated_at: nowIso(),
        },
        "id",
        submissionId
      );

      if (
        literaryAction === "disqualify" ||
        literaryAction === "needs_review" ||
        !publicationSuitable
      ) {
        const completedAt = nowIso();

        await markAssignmentCompleted(assignmentId, {
          decision: "disqualified",
          correction_notes: literaryProofreaderComment,
          completed_at: completedAt,
        });

        await safeUpdate(
          "submissions",
          {
            workflow_status: "disqualified",
            literary_publication_suitable: false,
            literary_updated_content: literaryUpdatedContent,
            literary_proofreader_comment: literaryProofreaderComment,
            completed_at: completedAt,
            updated_at: completedAt,
          },
          "id",
          submissionId
        );

        await closeOpenAssignmentsAfterDisqualification({
          submissionId,
          currentAssignmentId: assignmentId,
          completedAt,
        });
      } else if (literaryAction === "needs_correction") {
        await sendToCoordinatorForCorrection({
          submissionId,
          assignmentId,
          actorId: user.id,
          requesterId: assignment.assigned_to ?? user.id,
          sourcePhase: "literary_proofreading",
          correctionReason: "literary_needs_correction",
          correctionNotes: literaryProofreaderComment ?? literaryUpdatedContent,
        });
      } else {
        const completedAt = nowIso();

        await safeUpdate(
          "submissions",
          {
            literary_proofreading_completed_at: completedAt,
            updated_at: completedAt,
          },
          "id",
          submissionId
        );

        await markAssignmentCompleted(assignmentId, {
          decision: "completed",
          completed_at: completedAt,
        });

        const generalProofreaderId = await getCompletedGeneralProofreaderId(
          submissionId
        );

        if (generalProofreaderId) {
          await maybeAssignReviewerAfterProofreading(
            submissionId,
            generalProofreaderId,
            user.id
          );
        }
      }
    }

    if (phase === "management_review") {
      const managementAction = String(form.get("management_action") ?? "complete");
      const managementDecision = String(form.get("management_decision") ?? "approved");
      const managementArtisticRating = textValue(
        form,
        "management_artistic_rating"
      );
      const managementComment = textValue(form, "management_comment");
      const timestamp = nowIso();

      await addWorkflowComment({
        submissionId,
        authorId: user.id,
        phase,
        comment: managementComment,
      });

      if (managementAction === "pending") {
        await safeUpdate(
          "assignments",
          {
            status: "in_progress",
            decision: "pending",
            correction_notes: managementComment,
            completed_at: null,
            updated_at: timestamp,
          },
          "id",
          assignmentId
        );

        await safeUpdate(
          "submissions",
          {
            workflow_status: "needs_management_review",
            management_artistic_rating: managementArtisticRating,
            updated_at: timestamp,
          },
          "id",
          submissionId
        );
      } else if (managementDecision === "disqualified") {
        await markAssignmentCompleted(assignmentId, {
          decision: "disqualified",
          correction_notes: managementComment,
          completed_at: timestamp,
        });

        await safeUpdate(
          "submissions",
          {
            workflow_status: "disqualified",
            management_decision: "disqualified",
            management_artistic_rating: managementArtisticRating,
            completed_at: timestamp,
            updated_at: timestamp,
          },
          "id",
          submissionId
        );

        await reflectManagementDecisionToEvaluatorAssignments({
          submissionId,
          managementDecision: "disqualified",
          timestamp,
        });

        await resolveManagementSourceAssignment({
          managementAssignment: assignment,
          managementDecision: "disqualified",
          actorId: user.id,
          timestamp,
          comment: managementComment,
        });

        await closeOpenAssignmentsAfterDisqualification({
          submissionId,
          currentAssignmentId: assignmentId,
          completedAt: timestamp,
          sourceAssignmentId: assignment.correction_source_assignment_id ?? null,
        });
      } else {
        await markAssignmentCompleted(assignmentId, {
          decision: "approved",
          correction_notes: managementComment,
          completed_at: timestamp,
        });

        await safeUpdate(
          "submissions",
          {
            workflow_status: "selected_for_proofreading",
            management_decision: "approved",
            management_artistic_rating: managementArtisticRating,
            literary_management_approved_at: timestamp,
            updated_at: timestamp,
          },
          "id",
          submissionId
        );

        await reflectManagementDecisionToEvaluatorAssignments({
          submissionId,
          managementDecision: "approved",
          timestamp,
        });

        if (assignment.correction_source_phase) {
          await resolveManagementSourceAssignment({
            managementAssignment: assignment,
            managementDecision: "approved",
            actorId: user.id,
            timestamp,
            comment: managementComment,
          });
        } else {
          await assignProofreadingAfterApproval(submissionId, user.id);
        }
      }
    }

    if (phase === "final_review") {
      await updateEditableContent(submissionId, form);
      const completedAt = nowIso();

      await markAssignmentCompleted(assignmentId, {
        decision: "completed",
        completed_at: completedAt,
      });

      await safeUpdate(
        "submissions",
        {
          workflow_status: "ready_for_categorization",
          reviewer_decision: "completed",
          completed_at: null,
          updated_at: completedAt,
        },
        "id",
        submissionId
      );

      await assignCategorizationAfterReview(submissionId, user.id);
    }

    if (phase === "categorization") {
      const categorizedPathway = textValue(form, "categorized_pathway");
      const allowedPathways = new Set([
        "Visual Expressions",
        "Digital Expressions",
        "Performing Expressions",
        "Others & STEAM Expressions",
        "Literary Expressions",
      ]);

      if (!categorizedPathway || !allowedPathways.has(categorizedPathway)) {
        throw new Error("Select a valid pathway before completing categorization.");
      }

      const completedAt = nowIso();

      await markAssignmentCompleted(assignmentId, {
        decision: "completed",
        completed_at: completedAt,
      });

      await safeUpdate(
        "submissions",
        {
          categorized_pathway: categorizedPathway,
          categorization_completed_at: completedAt,
          workflow_status: "ready_for_artistic_ranking",
          completed_at: null,
          updated_at: completedAt,
        },
        "id",
        submissionId
      );

      await assignArtisticRankingAfterCategorization(submissionId, user.id);
    }

    if (phase === "artistic_ranking") {
      const artisticQualityCreativity = parseRubricScore(
        form.get("artistic_quality_creativity_score"),
        100,
        "Artistic Quality & Creativity"
      );
      const initiativeRelation = parseRubricScore(
        form.get("initiative_relation_score"),
        100,
        "Relation to the Initiative"
      );
      const ageAppropriateness = parseRubricScore(
        form.get("age_appropriateness_score"),
        100,
        "Age Appropriateness"
      );
      const totalScore = calculateArtisticRubricTotal({
        artisticQualityCreativity,
        initiativeRelation,
        ageAppropriateness,
      });

      if (totalScore < 1) {
        throw new Error("Total artistic rubric score must be at least 1.");
      }

      const artisticRanking = finalArtisticRatingFromScore(totalScore);
      const completedAt = nowIso();

      await markAssignmentCompleted(assignmentId, {
        decision: "completed",
        completed_at: completedAt,
      });

      await safeUpdate(
        "submissions",
        {
          artistic_quality_creativity_score: artisticQualityCreativity,
          initiative_relation_score: initiativeRelation,
          age_appropriateness_score: ageAppropriateness,
          artistic_rubric_total_score: totalScore,
          artistic_rubric_comment: null,
          artistic_ranking: artisticRanking,
          artistic_ranking_completed_at: completedAt,
          workflow_status: "completed",
          completed_at: completedAt,
          updated_at: completedAt,
        },
        "id",
        submissionId
      );

      await cancelActiveAssignmentsForCompletedWorkflow({
        submissionId,
        keepAssignmentId: assignmentId,
        completedAt,
      });
    }

    audit({
      actorId: user.id,
      action:
        (phase === "coordinator_check" &&
          String(form.get("coordinator_action") ?? "") === "save_progress") ||
        (phase === "management_review" &&
          String(form.get("management_action") ?? "") === "pending")
          ? "work_saved"
          : "work_completed",
      entityType: "assignment",
      entityId: assignmentId,
      before: {
        assignment_id: assignment.id,
        assignment_status: assignment.status,
        assignment_phase: assignment.phase,
        submission_id: submissionBefore.id,
        submission_reference_id: submissionBefore.reference_id,
        submission_workflow_status: submissionBefore.workflow_status,
      },
      after: {
        phase,
        submission_id: submissionId,
      },
    }).catch((auditError: any) => {
      console.error("Work completion audit failed:", auditError?.message ?? auditError);
    });

    return successResponse(req, redirectTo);
  } catch (error: any) {
    console.error("Work completion failed:", error);

    if (acceptsJson(req)) {
      return NextResponse.json(
        {
          error: error.message ?? "Work completion failed.",
        },
        { status: 500 }
      );
    }

    const errorUrl = refreshedUrl(req, redirectTo);
    errorUrl.searchParams.set(
      "work_error",
      error.message ?? "Work completion failed."
    );

    return NextResponse.redirect(errorUrl, { status: 303 });
  }
}
