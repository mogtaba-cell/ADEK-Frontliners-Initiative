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

function redirectWithRefresh(req: Request, redirectTo: string) {
  const url = new URL(redirectTo || "/", req.url);
  url.searchParams.set("refresh", Date.now().toString());
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
  const { data, error } = await supabaseAdmin
    .from("submissions")
    .select("*")
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
    updated_at: new Date().toISOString(),
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
  const completedAt = new Date().toISOString();

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

async function getCompletedGeneralProofreaderId(submissionId: string) {
  const { data, error } = await supabaseAdmin
    .from("assignments")
    .select("assigned_to")
    .eq("submission_id", submissionId)
    .eq("phase", "proofreading")
    .eq("proofreader_type", "general")
    .eq("status", "completed")
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
  await safeUpdate(
    "assignments",
    {
      status: "returned_for_correction",
      decision: "needs_correction",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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
      updated_at: new Date().toISOString(),
    },
    "id",
    submissionId
  );

  return autoAssignOne(submissionId, "coordinator_check", actorId, {
    requestedByUserId: requesterId,
    returnToUserId: requesterId,
    correctionReason,
    correctionNotes: correctionNotes ?? null,
    // These fields are written below for deployments where autoAssignOne
    // does not yet support source phase. The explicit update keeps old code safe.
  }).then(async (result) => {
    if (!result.skipped) {
      await safeUpdate(
        "assignments",
        {
          correction_source_phase: sourcePhase,
          correction_source_assignment_id: assignmentId,
        },
        "id",
        result.id
      );
    }

    return result;
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
  const sourcePhase = coordinatorAssignment.correction_source_phase as
    | WorkflowPhase
    | null;

  if (!sourcePhase) {
    throw new Error("Missing correction source phase. Cannot return correction.");
  }

  const returnToUserId =
    coordinatorAssignment.return_to_user_id ??
    coordinatorAssignment.requested_by_user_id;

  if (!returnToUserId) {
    throw new Error("Missing return user. Cannot return corrected submission.");
  }

  await markAssignmentCompleted(assignmentId, {
    decision: "corrected",
  });

  await safeUpdate(
    "submissions",
    {
      workflow_status: workflowStatusForReturnedSource(sourcePhase),
      updated_at: new Date().toISOString(),
    },
    "id",
    submissionId
  );

  return autoAssignOne(submissionId, sourcePhase, actorId, {
    assignedTo: returnToUserId,
    requestedByUserId: actorId,
    returnToUserId,
    correctionReason: coordinatorAssignment.correction_reason ?? null,
    correctionNotes: coordinatorAssignment.correction_notes ?? null,
    proofreaderType: coordinatorAssignment.proofreader_type ?? undefined,
  });
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
  await markAssignmentCompleted(assignmentId, {
    decision: "disqualified",
    correction_reason: reason,
  });

  await safeUpdate(
    "submissions",
    {
      workflow_status: "disqualified",
      disqualification_reason: reason,
      coordinator_disqualification_reason: reason,
      updated_at: new Date().toISOString(),
    },
    "id",
    submissionId
  );
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
            updated_at: new Date().toISOString(),
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
            updated_at: new Date().toISOString(),
          },
          "id",
          submissionId
        );

        await markAssignmentCompleted(assignmentId, {
          decision,
        });

        if (decision === "approved") {
          // Only approved submissions go to General/Literary proofreaders.
          // If literary language is missing, assignment.ts now assigns General
          // and skips Literary until Admin classifies the language.
          await assignProofreadingAfterApproval(submissionId, user.id);
        }

        if (decision === "needs_review") {
          // Needs Review goes to Management only, not proofreaders.
          await autoAssignOne(submissionId, "management_review", user.id, {
            requestedByUserId: user.id,
          });
        }
      }
    }

    if (phase === "coordinator_check") {
      await updateEditableContent(submissionId, form);

      const coordinatorAction = String(
        form.get("coordinator_action") ?? "return_corrected"
      );

      if (coordinatorAction === "disqualify_no_school_response") {
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
        const completedAt = new Date().toISOString();

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
          updated_at: completedAt,
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
      const publicationSuitable = yesNo(form.get("literary_publication_suitable"));
      const literaryUpdatedContent = textValue(form, "literary_updated_content");
      const literaryProofreaderComment = textValue(
        form,
        "literary_proofreader_comment"
      );

      await safeUpdate(
        "submissions",
        {
          literary_publication_suitable: publicationSuitable,
          literary_updated_content: literaryUpdatedContent,
          literary_proofreader_comment: literaryProofreaderComment,
          updated_at: new Date().toISOString(),
        },
        "id",
        submissionId
      );

      if (literaryAction === "needs_review" || !publicationSuitable) {
        await safeUpdate(
          "assignments",
          {
            status: "sent_for_review",
            decision: "needs_review",
            completed_at: new Date().toISOString(),
          },
          "id",
          assignmentId
        );

        await safeUpdate(
          "submissions",
          {
            workflow_status: "needs_management_review",
            updated_at: new Date().toISOString(),
          },
          "id",
          submissionId
        );

        await autoAssignOne(submissionId, "management_review", user.id, {
          requestedByUserId: assignment.assigned_to ?? user.id,
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
        const completedAt = new Date().toISOString();

        await safeUpdate(
          "submissions",
          {
            literary_proofreading_completed_at: completedAt,
            literary_proofreader_comment: literaryProofreaderComment,
            updated_at: completedAt,
          },
          "id",
          submissionId
        );

        await markAssignmentCompleted(assignmentId, {
          decision: "completed",
          completed_at: completedAt,
          updated_at: completedAt,
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
      const managementDecision = String(form.get("management_decision") ?? "approved");
      const managementArtisticRating = textValue(
        form,
        "management_artistic_rating"
      );

      if (managementDecision === "disqualified") {
        await markAssignmentCompleted(assignmentId, {
          decision: "disqualified",
        });

        await safeUpdate(
          "submissions",
          {
            workflow_status: "disqualified",
            management_decision: "disqualified",
            management_artistic_rating: managementArtisticRating,
            updated_at: new Date().toISOString(),
          },
          "id",
          submissionId
        );
      } else {
        await markAssignmentCompleted(assignmentId, {
          decision: "approved",
        });

        const { count: existingProofreadingCount } = await supabaseAdmin
          .from("assignments")
          .select("id", { count: "exact", head: true })
          .eq("submission_id", submissionId)
          .in("phase", ["proofreading", "literary_proofreading"]);

        await safeUpdate(
          "submissions",
          {
            workflow_status:
              existingProofreadingCount && existingProofreadingCount > 0
                ? "selected_for_proofreading"
                : "selected_for_proofreading",
            management_decision: "approved",
            management_artistic_rating: managementArtisticRating,
            literary_management_approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          "id",
          submissionId
        );

        if (!existingProofreadingCount) {
          await assignProofreadingAfterApproval(submissionId, user.id);
        } else {
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
    }

    if (phase === "final_review") {
      await updateEditableContent(submissionId, form);

      await markAssignmentCompleted(assignmentId, {
        decision: "completed",
      });

      await safeUpdate(
        "submissions",
        {
          workflow_status: "completed",
          reviewer_decision: "completed",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        "id",
        submissionId
      );
    }

    await audit({
      actorId: user.id,
      action: "work_completed",
      entityType: "assignment",
      entityId: assignmentId,
      before: {
        assignment,
        submission: submissionBefore,
      },
      after: {
        phase,
        submission_id: submissionId,
      },
    });

    return redirectWithRefresh(req, redirectTo);
  } catch (error: any) {
    console.error("Work completion failed:", error);

    const acceptsJson = req.headers
      .get("accept")
      ?.toLowerCase()
      .includes("application/json");

    if (acceptsJson) {
      return NextResponse.json(
        {
          error: error.message ?? "Work completion failed.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: error.message ?? "Work completion failed.",
      },
      { status: 500 }
    );
  }
}
