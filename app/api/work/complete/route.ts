import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { audit } from "@/lib/audit";
import {
  assignProofreadingAfterApproval,
  autoAssignOne,
  maybeAssignReviewerAfterProofreading,
} from "@/lib/assignment";
import type { WorkflowPhase } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function yesNo(value: FormDataEntryValue | null) {
  return String(value ?? "").toLowerCase() === "yes";
}

function calculateAdekDecision(a: boolean, b: boolean, c: boolean) {
  if (a && b && c) return "approved";
  if (!a || !c) return "disqualified";
  return "needs_review";
}

function redirectWithRefresh(req: Request, redirectTo: string) {
  const url = new URL(redirectTo || "/", req.url);
  url.searchParams.set("refresh", Date.now().toString());

  return NextResponse.redirect(url, {
    status: 303,
  });
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

async function saveComment({
  submissionId,
  userId,
  phase,
  comment,
}: {
  submissionId: string;
  userId: string;
  phase: string;
  comment: string;
}) {
  if (!comment.trim()) return;

  const { error } = await supabaseAdmin.from("comments").insert({
    submission_id: submissionId,
    author_id: userId,
    phase,
    comment_text: comment.trim(),
  });

  if (error) {
    console.error("Comment save failed:", error.message);
  }
}

async function saveArtworkText(form: FormData, submissionId: string) {
  await safeUpdate(
    "submissions",
    {
      artwork_title_en: String(form.get("artwork_title_en") ?? "").trim() || null,
      artwork_title_ar: String(form.get("artwork_title_ar") ?? "").trim() || null,
      description_en: String(form.get("description_en") ?? "").trim() || null,
      description_ar: String(form.get("description_ar") ?? "").trim() || null,
      influence_idea_source:
        String(form.get("influence_idea_source") ?? "").trim() || null,
      most_enjoyable_part:
        String(form.get("most_enjoyable_part") ?? "").trim() || null,
      focused_elements:
        String(form.get("focused_elements") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    },
    "id",
    submissionId
  );
}

async function upsertEvaluation({
  submissionId,
  userId,
  cultural,
  artistic,
  ethical,
  decision,
}: {
  submissionId: string;
  userId: string;
  cultural: boolean;
  artistic: boolean;
  ethical: boolean;
  decision: string;
}) {
  const payload = {
    submission_id: submissionId,
    evaluator_id: userId,
    cultural_authenticity: cultural ? "yes" : "no",
    artistic_excellence: artistic ? "yes" : "no",
    ethical_public_appropriateness: ethical ? "yes" : "no",
    decision,
    updated_at: new Date().toISOString(),
  };

  const existing = await supabaseAdmin
    .from("evaluations")
    .select("id")
    .eq("submission_id", submissionId)
    .eq("evaluator_id", userId)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`Evaluation lookup failed: ${existing.error.message}`);
  }

  if (existing.data?.id) {
    const { error } = await supabaseAdmin
      .from("evaluations")
      .update(payload)
      .eq("id", existing.data.id);

    if (error) {
      throw new Error(`Evaluation update failed: ${error.message}`);
    }
  } else {
    const { error } = await supabaseAdmin.from("evaluations").insert(payload);

    if (error) {
      throw new Error(`Evaluation insert failed: ${error.message}`);
    }
  }
}

async function completeAssignment(
  assignmentId: string,
  now: string,
  decision?: string
) {
  await safeUpdate(
    "assignments",
    {
      status: "completed",
      completed_at: now,
      updated_at: now,
      ...(decision ? { decision } : {}),
    },
    "id",
    assignmentId
  );
}

async function markAssignmentReturnedForCorrection({
  assignmentId,
  requesterId,
  correctionReason,
  correctionSourcePhase,
  now,
}: {
  assignmentId: string;
  requesterId: string;
  correctionReason: string;
  correctionSourcePhase: string;
  now: string;
}) {
  await safeUpdate(
    "assignments",
    {
      status: "returned_for_correction",
      completed_at: null,
      updated_at: now,
      correction_reason: correctionReason,
      correction_source_phase: correctionSourcePhase,
      requested_by_user_id: requesterId,
      return_to_user_id: requesterId,
    },
    "id",
    assignmentId
  );
}

async function markProofreadingReturnedForCorrection({
  assignmentId,
  submissionId,
  proofreaderId,
  correctionReason,
  now,
}: {
  assignmentId: string;
  submissionId: string;
  proofreaderId: string;
  correctionReason: string;
  now: string;
}) {
  await markAssignmentReturnedForCorrection({
    assignmentId,
    requesterId: proofreaderId,
    correctionReason,
    correctionSourcePhase: "proofreading",
    now,
  });

  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "returned_for_correction",
      completed_at: null,
      updated_at: now,
      correction_reason: correctionReason,
      correction_source_phase: "proofreading",
      requested_by_user_id: proofreaderId,
      return_to_user_id: proofreaderId,
    })
    .eq("submission_id", submissionId)
    .eq("phase", "proofreading")
    .eq("assigned_to", proofreaderId)
    .eq("status", "completed");

  if (error) {
    throw new Error(
      `proofreading assignment correction cleanup failed: ${error.message}`
    );
  }
}

async function markLiteraryReturnedForCorrection({
  assignmentId,
  submissionId,
  proofreaderId,
  correctionReason,
  now,
}: {
  assignmentId: string;
  submissionId: string;
  proofreaderId: string;
  correctionReason: string;
  now: string;
}) {
  await markAssignmentReturnedForCorrection({
    assignmentId,
    requesterId: proofreaderId,
    correctionReason,
    correctionSourcePhase: "literary_proofreading",
    now,
  });

  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "returned_for_correction",
      completed_at: null,
      updated_at: now,
      correction_reason: correctionReason,
      correction_source_phase: "literary_proofreading",
      requested_by_user_id: proofreaderId,
      return_to_user_id: proofreaderId,
    })
    .eq("submission_id", submissionId)
    .eq("phase", "literary_proofreading")
    .eq("assigned_to", proofreaderId)
    .eq("status", "completed");

  if (error) {
    throw new Error(
      `literary assignment correction cleanup failed: ${error.message}`
    );
  }
}

async function markLiterarySentForReview({
  assignmentId,
  submissionId,
  proofreaderId,
  now,
}: {
  assignmentId: string;
  submissionId: string;
  proofreaderId: string;
  now: string;
}) {
  await safeUpdate(
    "assignments",
    {
      status: "sent_for_review",
      completed_at: null,
      updated_at: now,
      correction_reason: "literary_needs_review",
      correction_source_phase: "literary_proofreading",
      requested_by_user_id: proofreaderId,
      return_to_user_id: proofreaderId,
    },
    "id",
    assignmentId
  );

  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "sent_for_review",
      completed_at: null,
      updated_at: now,
      correction_reason: "literary_needs_review",
      correction_source_phase: "literary_proofreading",
      requested_by_user_id: proofreaderId,
      return_to_user_id: proofreaderId,
    })
    .eq("submission_id", submissionId)
    .eq("phase", "literary_proofreading")
    .eq("assigned_to", proofreaderId)
    .eq("status", "completed");

  if (error) {
    throw new Error(
      `literary proofreader sent-for-review cleanup failed: ${error.message}`
    );
  }
}

async function closeLiterarySentForReviewAssignments({
  submissionId,
  now,
  decision,
}: {
  submissionId: string;
  now: string;
  decision: string;
}) {
  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "completed",
      completed_at: now,
      updated_at: now,
      decision,
    })
    .eq("submission_id", submissionId)
    .eq("phase", "literary_proofreading")
    .eq("status", "sent_for_review");

  if (error) {
    throw new Error(
      `literary sent-for-review close failed: ${error.message}`
    );
  }
}

async function sendToCoordinatorForCorrection({
  submissionId,
  requesterId,
  sourceAssignmentId,
  correctionReason,
  correctionSourcePhase,
}: {
  submissionId: string;
  requesterId: string;
  sourceAssignmentId: string;
  correctionReason: string;
  correctionSourcePhase: string;
}) {
  const coordinatorAssignment = await autoAssignOne(
    submissionId,
    "coordinator_check",
    requesterId,
    {
      requestedByUserId: requesterId,
      returnToUserId: requesterId,
      correctionReason,
    }
  );

  await safeUpdate(
    "assignments",
    {
      requested_by_user_id: requesterId,
      return_to_user_id: requesterId,
      correction_reason: correctionReason,
      correction_source_phase: correctionSourcePhase,
      correction_source_assignment_id: sourceAssignmentId,
      updated_at: new Date().toISOString(),
    },
    "id",
    coordinatorAssignment.id
  );

  return coordinatorAssignment;
}

async function returnFromCoordinatorToRequester({
  submissionId,
  coordinatorUserId,
  returnToUserId,
  sourcePhase,
}: {
  submissionId: string;
  coordinatorUserId: string;
  returnToUserId: string;
  sourcePhase?: string | null;
}) {
  if (sourcePhase === "adek_evaluation") {
    await safeUpdate(
      "submissions",
      {
        workflow_status: "ready_for_adek",
        updated_at: new Date().toISOString(),
      },
      "id",
      submissionId
    );

    return autoAssignOne(submissionId, "adek_evaluation", coordinatorUserId, {
      assignedTo: returnToUserId,
      requestedByUserId: coordinatorUserId,
    });
  }

  if (sourcePhase === "literary_proofreading") {
    await safeUpdate(
      "submissions",
      {
        workflow_status: "selected_for_proofreading",
        updated_at: new Date().toISOString(),
      },
      "id",
      submissionId
    );

    return autoAssignOne(
      submissionId,
      "literary_proofreading",
      coordinatorUserId,
      {
        assignedTo: returnToUserId,
        requestedByUserId: coordinatorUserId,
        proofreaderType: "literary",
      }
    );
  }

  await safeUpdate(
    "submissions",
    {
      workflow_status: "selected_for_proofreading",
      updated_at: new Date().toISOString(),
    },
    "id",
    submissionId
  );

  return autoAssignOne(submissionId, "proofreading", coordinatorUserId, {
    assignedTo: returnToUserId,
    requestedByUserId: coordinatorUserId,
    proofreaderType: "general",
  });
}

async function assignManagementReview({
  submissionId,
  requestedByUserId,
  correctionReason,
  correctionSourcePhase,
  returnToUserId,
}: {
  submissionId: string;
  requestedByUserId: string;
  correctionReason: string;
  correctionSourcePhase: string;
  returnToUserId?: string | null;
}) {
  const managementAssignment = await autoAssignOne(
    submissionId,
    "management_review",
    requestedByUserId,
    {
      requestedByUserId,
      returnToUserId: returnToUserId ?? requestedByUserId,
      correctionReason,
    }
  );

  await safeUpdate(
    "assignments",
    {
      requested_by_user_id: requestedByUserId,
      return_to_user_id: returnToUserId ?? requestedByUserId,
      correction_reason: correctionReason,
      correction_source_phase: correctionSourcePhase,
      updated_at: new Date().toISOString(),
    },
    "id",
    managementAssignment.id
  );

  return managementAssignment;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser([
      "coordinator",
      "evaluator",
      "management",
      "proofreader",
      "reviewer",
      "admin",
    ]);

    const form = await req.formData();

    const assignmentId = String(form.get("assignment_id") ?? "");
    const submissionId = String(form.get("submission_id") ?? "");
    const phase = String(form.get("phase") ?? "") as WorkflowPhase;
    const redirectTo = String(form.get("redirect_to") ?? "/");
    const comment = String(form.get("comment") ?? "");

    if (!assignmentId) throw new Error("Missing assignment_id.");
    if (!submissionId) throw new Error("Missing submission_id.");
    if (!phase) throw new Error("Missing phase.");

    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from("assignments")
      .select(
        "id,assigned_to,phase,status,requested_by_user_id,return_to_user_id,correction_reason,correction_source_phase"
      )
      .eq("id", assignmentId)
      .single();

    if (assignmentError) {
      throw new Error(`Assignment lookup failed: ${assignmentError.message}`);
    }

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    if (assignment.assigned_to !== user.id && user.role !== "admin") {
      throw new Error("FORBIDDEN");
    }

    const now = new Date().toISOString();

    if (assignment.status === "completed") {
      const { data: submissionCheck } = await supabaseAdmin
        .from("submissions")
        .select("workflow_status")
        .eq("id", submissionId)
        .maybeSingle();

      if (
        phase === "proofreading" &&
        submissionCheck?.workflow_status === "returned_for_correction"
      ) {
        await markProofreadingReturnedForCorrection({
          assignmentId,
          submissionId,
          proofreaderId: assignment.assigned_to,
          correctionReason:
            assignment.correction_reason ?? "incomplete_narrative",
          now,
        });
      }

      if (
        phase === "literary_proofreading" &&
        submissionCheck?.workflow_status === "needs_management_review"
      ) {
        await markLiterarySentForReview({
          assignmentId,
          submissionId,
          proofreaderId: assignment.assigned_to,
          now,
        });
      }

      return redirectWithRefresh(req, redirectTo);
    }

    if (phase !== "coordinator_check" && comment.trim()) {
      await saveComment({
        submissionId,
        userId: user.id,
        phase,
        comment,
      });
    }

    if (phase === "adek_evaluation") {
      const canEvaluate = yesNo(form.get("adek_file_quality_clear"));
      const artisticRating = String(form.get("artistic_rating") ?? "").trim();

      if (!canEvaluate) {
        await safeUpdate(
          "submissions",
          {
            workflow_status: "returned_for_correction",
            evaluator_file_quality_clear: false,
            updated_at: now,
          },
          "id",
          submissionId
        );

        await markAssignmentReturnedForCorrection({
          assignmentId,
          requesterId: user.id,
          correctionReason: "adek_file_quality",
          correctionSourcePhase: "adek_evaluation",
          now,
        });

        const coordinatorAssignment = await sendToCoordinatorForCorrection({
          submissionId,
          requesterId: user.id,
          sourceAssignmentId: assignmentId,
          correctionReason: "adek_file_quality",
          correctionSourcePhase: "adek_evaluation",
        });

        await audit({
          actorId: user.id,
          action: "adek_sent_for_correction",
          entityType: "assignment",
          entityId: assignmentId,
          after: {
            phase,
            submission_id: submissionId,
            correction_reason: "adek_file_quality",
            coordinator_assignment_id: coordinatorAssignment.id,
          },
        });

        return redirectWithRefresh(req, redirectTo);
      }

      const cultural = yesNo(form.get("cultural_authenticity"));
      const artistic = yesNo(form.get("artistic_excellence"));
      const ethical = yesNo(form.get("ethical_public_appropriateness"));
      const decision = calculateAdekDecision(cultural, artistic, ethical);

      await upsertEvaluation({
        submissionId,
        userId: user.id,
        cultural,
        artistic,
        ethical,
        decision,
      });

      await safeUpdate(
        "submissions",
        {
          evaluator_file_quality_clear: true,
          artistic_rating: artisticRating || null,
          updated_at: now,
        },
        "id",
        submissionId
      );

      if (decision === "approved") {
        await safeUpdate(
          "submissions",
          {
            workflow_status: "selected_for_proofreading",
            updated_at: now,
          },
          "id",
          submissionId
        );

        await assignProofreadingAfterApproval(submissionId, user.id);
      } else if (decision === "needs_review") {
        await safeUpdate(
          "submissions",
          {
            workflow_status: "needs_management_review",
            updated_at: now,
          },
          "id",
          submissionId
        );

        await assignManagementReview({
          submissionId,
          requestedByUserId: user.id,
          correctionReason: "adek_needs_review",
          correctionSourcePhase: "adek_evaluation",
        });
      } else {
        await safeUpdate(
          "submissions",
          {
            workflow_status: "disqualified",
            updated_at: now,
          },
          "id",
          submissionId
        );
      }

      await completeAssignment(assignmentId, now, decision);

      await audit({
        actorId: user.id,
        action: "adek_evaluation_completed",
        entityType: "assignment",
        entityId: assignmentId,
        after: {
          phase,
          submission_id: submissionId,
          decision,
          artistic_rating: artisticRating || null,
        },
      });

      return redirectWithRefresh(req, redirectTo);
    }

    if (phase === "proofreading") {
      await saveArtworkText(form, submissionId);

      const decision = String(
        form.get("general_proofreader_decision") ?? "ready"
      );

      if (decision === "needs_correction") {
        const correctionReason = String(
          form.get("correction_reason") ?? "incomplete_narrative"
        );

        await safeUpdate(
          "submissions",
          {
            workflow_status: "returned_for_correction",
            updated_at: now,
          },
          "id",
          submissionId
        );

        await markProofreadingReturnedForCorrection({
          assignmentId,
          submissionId,
          proofreaderId: user.id,
          correctionReason,
          now,
        });

        const coordinatorAssignment = await sendToCoordinatorForCorrection({
          submissionId,
          requesterId: user.id,
          sourceAssignmentId: assignmentId,
          correctionReason,
          correctionSourcePhase: "proofreading",
        });

        await audit({
          actorId: user.id,
          action: "proofreading_returned_for_correction",
          entityType: "assignment",
          entityId: assignmentId,
          after: {
            phase,
            submission_id: submissionId,
            correction_reason: correctionReason,
            coordinator_assignment_id: coordinatorAssignment.id,
          },
        });

        return redirectWithRefresh(req, redirectTo);
      }

      await safeUpdate(
        "submissions",
        {
          workflow_status: "proofreading_done",
          general_proofreading_completed_at: now,
          updated_at: now,
        },
        "id",
        submissionId
      );

      await completeAssignment(assignmentId, now, "ready");

      await maybeAssignReviewerAfterProofreading(submissionId, user.id, user.id);

      await audit({
        actorId: user.id,
        action: "proofreading_completed",
        entityType: "assignment",
        entityId: assignmentId,
        after: {
          phase,
          submission_id: submissionId,
        },
      });

      return redirectWithRefresh(req, redirectTo);
    }

    if (phase === "literary_proofreading") {
      const suitable = yesNo(form.get("literary_publication_suitable"));
      const action = String(
        form.get("literary_action") ?? (suitable ? "completed" : "needs_review")
      );
      const updatedContent =
        String(form.get("literary_updated_content") ?? "").trim() || null;

      if (!suitable || action === "needs_review") {
        await safeUpdate(
          "submissions",
          {
            workflow_status: "needs_management_review",
            literary_publication_suitable: false,
            updated_at: now,
          },
          "id",
          submissionId
        );

        const managementAssignment = await assignManagementReview({
          submissionId,
          requestedByUserId: user.id,
          returnToUserId: user.id,
          correctionReason: "literary_needs_review",
          correctionSourcePhase: "literary_proofreading",
        });

        await markLiterarySentForReview({
          assignmentId,
          submissionId,
          proofreaderId: user.id,
          now,
        });

        await audit({
          actorId: user.id,
          action: "literary_proofreading_sent_to_management",
          entityType: "assignment",
          entityId: assignmentId,
          after: {
            phase,
            submission_id: submissionId,
            decision: "needs_review",
            management_assignment_id: managementAssignment.id,
          },
        });

        return redirectWithRefresh(req, redirectTo);
      }

      await safeUpdate(
        "submissions",
        {
          literary_publication_suitable: true,
          literary_updated_content: updatedContent,
          updated_at: now,
        },
        "id",
        submissionId
      );

      if (action === "needs_correction") {
        await safeUpdate(
          "submissions",
          {
            workflow_status: "returned_for_correction",
            updated_at: now,
          },
          "id",
          submissionId
        );

        await markLiteraryReturnedForCorrection({
          assignmentId,
          submissionId,
          proofreaderId: user.id,
          correctionReason: "literary_needs_correction",
          now,
        });

        const coordinatorAssignment = await sendToCoordinatorForCorrection({
          submissionId,
          requesterId: user.id,
          sourceAssignmentId: assignmentId,
          correctionReason: "literary_needs_correction",
          correctionSourcePhase: "literary_proofreading",
        });

        await audit({
          actorId: user.id,
          action: "literary_proofreading_returned_for_correction",
          entityType: "assignment",
          entityId: assignmentId,
          after: {
            phase,
            submission_id: submissionId,
            correction_reason: "literary_needs_correction",
            coordinator_assignment_id: coordinatorAssignment.id,
          },
        });

        return redirectWithRefresh(req, redirectTo);
      }

      await safeUpdate(
        "submissions",
        {
          literary_publication_suitable: true,
          literary_updated_content: updatedContent,
          literary_proofreading_completed_at: now,
          updated_at: now,
        },
        "id",
        submissionId
      );

      await completeAssignment(assignmentId, now, "completed");

      const { data: completedGeneral } = await supabaseAdmin
        .from("assignments")
        .select("assigned_to")
        .eq("submission_id", submissionId)
        .eq("phase", "proofreading")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (completedGeneral?.assigned_to) {
        await maybeAssignReviewerAfterProofreading(
          submissionId,
          completedGeneral.assigned_to,
          user.id
        );
      }

      await audit({
        actorId: user.id,
        action: "literary_proofreading_completed",
        entityType: "assignment",
        entityId: assignmentId,
        after: {
          phase,
          submission_id: submissionId,
          decision: "completed",
        },
      });

      return redirectWithRefresh(req, redirectTo);
    }

    if (phase === "coordinator_check") {
      await saveArtworkText(form, submissionId);

      const returnToUserId =
        assignment.return_to_user_id ?? assignment.requested_by_user_id;

      if (!returnToUserId) {
        throw new Error("Missing user to return correction to.");
      }

      await returnFromCoordinatorToRequester({
        submissionId,
        coordinatorUserId: user.id,
        returnToUserId,
        sourcePhase: assignment.correction_source_phase,
      });

      await completeAssignment(assignmentId, now, "corrected");

      await audit({
        actorId: user.id,
        action: "coordinator_correction_completed",
        entityType: "assignment",
        entityId: assignmentId,
        after: {
          phase,
          submission_id: submissionId,
          returned_to_user_id: returnToUserId,
          correction_source_phase: assignment.correction_source_phase,
        },
      });

      return redirectWithRefresh(req, redirectTo);
    }

    if (phase === "management_review") {
      const decision = String(form.get("management_decision") ?? "approved");
      const managementArtisticRating = String(
        form.get("management_artistic_rating") ?? ""
      ).trim();

      const fromLiterary =
        assignment.correction_reason === "literary_needs_review" ||
        assignment.correction_source_phase === "literary_proofreading";

      if (decision === "approved") {
        if (fromLiterary) {
          const returnToUserId =
            assignment.return_to_user_id ?? assignment.requested_by_user_id;

          if (!returnToUserId) {
            throw new Error("Missing literary proofreader to return review to.");
          }

          await safeUpdate(
            "submissions",
            {
              literary_publication_suitable: true,
              literary_management_approved_at: now,
              workflow_status: "selected_for_proofreading",
              management_artistic_rating: managementArtisticRating || null,
              updated_at: now,
            },
            "id",
            submissionId
          );

          await closeLiterarySentForReviewAssignments({
            submissionId,
            now,
            decision: "management_approved",
          });

          await autoAssignOne(
            submissionId,
            "literary_proofreading",
            user.id,
            {
              assignedTo: returnToUserId,
              requestedByUserId: user.id,
              proofreaderType: "literary",
            }
          );
        } else {
          await safeUpdate(
            "submissions",
            {
              workflow_status: "selected_for_proofreading",
              management_artistic_rating: managementArtisticRating || null,
              updated_at: now,
            },
            "id",
            submissionId
          );

          await assignProofreadingAfterApproval(submissionId, user.id);
        }
      } else {
        await safeUpdate(
          "submissions",
          {
            workflow_status: "disqualified",
            management_artistic_rating: managementArtisticRating || null,
            updated_at: now,
          },
          "id",
          submissionId
        );

        if (fromLiterary) {
          await closeLiterarySentForReviewAssignments({
            submissionId,
            now,
            decision: "management_disqualified",
          });
        }
      }

      await completeAssignment(assignmentId, now, decision);

      await audit({
        actorId: user.id,
        action: "management_review_completed",
        entityType: "assignment",
        entityId: assignmentId,
        after: {
          phase,
          submission_id: submissionId,
          decision,
          management_artistic_rating: managementArtisticRating || null,
          from_literary: fromLiterary,
        },
      });

      return redirectWithRefresh(req, redirectTo);
    }

    if (phase === "final_review") {
      const decision = String(form.get("reviewer_decision") ?? "completed");

      await saveArtworkText(form, submissionId);

      await safeUpdate(
        "submissions",
        {
          workflow_status: "completed",
          updated_at: now,
        },
        "id",
        submissionId
      );

      await completeAssignment(assignmentId, now, decision);

      await audit({
        actorId: user.id,
        action: "final_review_completed",
        entityType: "assignment",
        entityId: assignmentId,
        after: {
          phase,
          submission_id: submissionId,
          decision,
        },
      });

      return redirectWithRefresh(req, redirectTo);
    }

    throw new Error(`Unsupported phase: ${phase}`);
  } catch (error: any) {
    console.error("Task completion failed:", error);

    return NextResponse.json(
      {
        error: error.message ?? "Failed to complete task.",
      },
      {
        status:
          error.message === "FORBIDDEN" || error.message === "UNAUTHENTICATED"
            ? 403
            : 500,
      }
    );
  }
}