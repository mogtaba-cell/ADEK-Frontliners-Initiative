import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { autoAssignOne } from "@/lib/assignment";
import { audit } from "@/lib/audit";
import { evaluationDecision } from "@/lib/decision";
import { roleHome } from "@/lib/workflow";
import type { WorkflowPhase } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boolField(f: FormData, name: string) {
  return f.get(name) === "true";
}

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

async function completeAssignment(assignmentId: string | null, userId: string) {
  if (!assignmentId) return;
  await supabaseAdmin
    .from("assignments")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .eq("assigned_to", userId);
}

async function addComment(submissionId: string, authorId: string, phase: WorkflowPhase | null, comment: string) {
  if (!comment) return;
  await supabaseAdmin.from("comments").insert({ submission_id: submissionId, author_id: authorId, phase, comment_text: comment });
}

async function getBefore(submissionId: string) {
  const { data } = await supabaseAdmin.from("submissions").select("id,reference_id,workflow_status").eq("id", submissionId).single();
  return data;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const f = await req.formData();

    const submissionId = cleanText(f.get("submission_id"));
    const assignmentId = cleanText(f.get("assignment_id")) || null;
    const action = cleanText(f.get("action"));
    const comment = cleanText(f.get("comment"));

    if (!submissionId || !action) throw new Error("Missing workflow action details.");

    const before = await getBefore(submissionId);
    if (!before) throw new Error("Submission not found.");

    let nextStatus = before.workflow_status;
    let phase: WorkflowPhase | null = null;
    let auditAfter: Record<string, any> = { action };

    if (user.role === "coordinator") {
      phase = "coordinator_check";
      await addComment(submissionId, user.id, phase, comment);

      if (action === "coordinator_ready") {
        nextStatus = "ready_for_adek";
        await completeAssignment(assignmentId, user.id);
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
        await autoAssignOne(submissionId, "adek_evaluation", user.id).catch(() => null);
      } else if (action === "coordinator_return") {
        nextStatus = "returned_for_correction";
        await completeAssignment(assignmentId, user.id);
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
      } else {
        throw new Error("Invalid coordinator action.");
      }
    } else if (user.role === "evaluator") {
      phase = "adek_evaluation";
      const cultural = cleanText(f.get("cultural_authenticity"));
      const artistic = cleanText(f.get("artistic_excellence"));
      const ethical = cleanText(f.get("ethical_public_appropriateness"));
      const decision = evaluationDecision(cultural, artistic, ethical);

      await supabaseAdmin.from("evaluations").upsert(
        {
          submission_id: submissionId,
          evaluator_id: user.id,
          cultural_authenticity: cultural,
          artistic_excellence: artistic,
          ethical_public_appropriateness: ethical,
          decision,
          comments: comment || null,
        },
        { onConflict: "submission_id,evaluator_id" }
      );

      await addComment(submissionId, user.id, phase, comment);
      await completeAssignment(assignmentId, user.id);

      if (decision === "approved") {
        nextStatus = "selected_for_proofreading";
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
        await autoAssignOne(submissionId, "proofreading", user.id).catch(() => null);
      } else if (decision === "needs_review") {
        nextStatus = "needs_management_review";
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
        await autoAssignOne(submissionId, "management_review", user.id).catch(() => null);
      } else if (decision === "disqualified") {
        nextStatus = "disqualified";
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
      }

      auditAfter = { ...auditAfter, cultural, artistic, ethical, decision };
    } else if (user.role === "management") {
      phase = "management_review";
      if (!comment) throw new Error("Management decision requires a reason/comment.");

      if (action === "management_approve") {
        nextStatus = "selected_for_proofreading";
        await supabaseAdmin.from("management_reviews").upsert(
          { submission_id: submissionId, reviewer_id: user.id, decision: "approved", reason: comment },
          { onConflict: "submission_id" }
        );
        await completeAssignment(assignmentId, user.id);
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
        await autoAssignOne(submissionId, "proofreading", user.id).catch(() => null);
      } else if (action === "management_disqualify") {
        nextStatus = "disqualified";
        await supabaseAdmin.from("management_reviews").upsert(
          { submission_id: submissionId, reviewer_id: user.id, decision: "disqualified", reason: comment },
          { onConflict: "submission_id" }
        );
        await completeAssignment(assignmentId, user.id);
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
      } else if (action === "management_return") {
        nextStatus = "ready_for_adek";
        await completeAssignment(assignmentId, user.id);
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
        await autoAssignOne(submissionId, "adek_evaluation", user.id).catch(() => null);
      } else {
        throw new Error("Invalid management action.");
      }

      await addComment(submissionId, user.id, phase, comment);
    } else if (user.role === "proofreader") {
      phase = "proofreading";
      nextStatus = "proofreading_done";

      await supabaseAdmin.from("proofreading_tasks").upsert(
        {
          submission_id: submissionId,
          proofreader_id: user.id,
          status: "done",
          arabic_title_reviewed: boolField(f, "arabic_title_reviewed"),
          english_title_reviewed: boolField(f, "english_title_reviewed"),
          arabic_description_reviewed: boolField(f, "arabic_description_reviewed"),
          english_description_reviewed: boolField(f, "english_description_reviewed"),
          notes: comment || null,
          completed_at: new Date().toISOString(),
        },
        { onConflict: "submission_id" }
      );
      await addComment(submissionId, user.id, phase, comment);
      await completeAssignment(assignmentId, user.id);
      await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
      await autoAssignOne(submissionId, "final_review", user.id).catch(() => null);
    } else if (user.role === "reviewer") {
      phase = "final_review";

      if (action === "review_complete") {
        nextStatus = "completed";
        await supabaseAdmin.from("final_reviews").upsert(
          { submission_id: submissionId, reviewer_id: user.id, status: "completed", notes: comment || null, completed_at: new Date().toISOString() },
          { onConflict: "submission_id" }
        );
        await completeAssignment(assignmentId, user.id);
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
      } else if (action === "review_return") {
        nextStatus = "selected_for_proofreading";
        await supabaseAdmin.from("final_reviews").upsert(
          { submission_id: submissionId, reviewer_id: user.id, status: "returned_to_proofreader", notes: comment || null, completed_at: null },
          { onConflict: "submission_id" }
        );
        await completeAssignment(assignmentId, user.id);
        await supabaseAdmin.from("submissions").update({ workflow_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", submissionId);
        await autoAssignOne(submissionId, "proofreading", user.id).catch(() => null);
      } else {
        throw new Error("Invalid final review action.");
      }

      await addComment(submissionId, user.id, phase, comment);
    } else {
      throw new Error("This role cannot complete workflow actions.");
    }

    await audit({ actorId: user.id, action: "workflow_action", entityType: "submission", entityId: submissionId, before, after: { ...auditAfter, workflow_status: nextStatus } });
    try {
      await supabaseAdmin.rpc("refresh_analytics_materialized_views");
    } catch {
      // Analytics summaries are a performance cache; workflow completion should not fail if refresh is unavailable locally.
    }

    return NextResponse.redirect(new URL(roleHome[user.role], req.url));
  } catch (e: any) {
    console.error("Workflow action failed:", e);
    return NextResponse.json({ error: e.message ?? "Workflow action failed." }, { status: 500 });
  }
}
