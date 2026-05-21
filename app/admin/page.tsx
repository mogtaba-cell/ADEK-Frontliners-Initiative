import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { AssignmentEngineClient } from "@/app/admin/AssignmentEngineClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireUser(["admin"]);

  const [
    submissions,
    activeAssignments,
    lastExport,
    readyForAdek,
    assignedToEvaluators,
    sentForCorrection,
    needsManagementReview,
    selectedForProofreading,
    proofreadingDone,
    literaryProofreadingDone,
    disqualified,
    completed,
  ] = await Promise.all([
    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true }),

    supabaseAdmin
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .in("status", ["assigned", "in_progress"]),

    supabaseAdmin
      .from("export_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1),

    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("workflow_status", "ready_for_adek"),

    // Assigned to Evaluators = active ADEK evaluator tasks.
    supabaseAdmin
      .from("assignments")
      .select("submission_id", { count: "exact", head: true })
      .eq("phase", "adek_evaluation")
      .in("status", ["assigned", "in_progress"]),

    // Sent for correction = currently active Coordinator correction tasks.
    // This drops automatically after the Coordinator sends it back.
    supabaseAdmin
      .from("assignments")
      .select("submission_id", { count: "exact", head: true })
      .eq("phase", "coordinator_check")
      .in("status", ["assigned", "in_progress"]),

    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("workflow_status", "needs_management_review"),

    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("workflow_status", "selected_for_proofreading"),

    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("workflow_status", "proofreading_done"),

    // Literary Proofreading Done = completed literary proofreading assignments.
    supabaseAdmin
      .from("assignments")
      .select("submission_id", { count: "exact", head: true })
      .eq("phase", "literary_proofreading")
      .eq("status", "completed"),

    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("workflow_status", "disqualified"),

    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("workflow_status", "completed"),
  ]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <h1>Admin Dashboard</h1>

      <div className="grid grid-3">
        <div className="card">
          <h2>Total Submissions</h2>
          <p className="stat-number">{submissions.count ?? 0}</p>
        </div>

        <div className="card">
          <h2>Active Assignments</h2>
          <p className="stat-number">{activeAssignments.count ?? 0}</p>
        </div>

        <div className="card">
          <h2>Last Export</h2>
          <p>{lastExport.data?.[0]?.status ?? "No exports yet"}</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Workflow Overview</h2>

        <p className="muted">
          These counts show where submissions currently are in the workflow.
          Normal movement between users is automatic after tasks are completed.
        </p>

        <div className="grid grid-4">
          <div>
            <strong>Ready for ADEK</strong>
            <p className="stat-number">{readyForAdek.count ?? 0}</p>
          </div>

          <div>
            <strong>Assigned to Evaluators</strong>
            <p className="stat-number">{assignedToEvaluators.count ?? 0}</p>
          </div>

          <div>
            <strong>Sent for Correction</strong>
            <p className="stat-number">{sentForCorrection.count ?? 0}</p>
          </div>

          <div>
            <strong>Needs Management Review</strong>
            <p className="stat-number">{needsManagementReview.count ?? 0}</p>
          </div>

          <div>
            <strong>Selected for Proofreading</strong>
            <p className="stat-number">{selectedForProofreading.count ?? 0}</p>
          </div>

          <div>
            <strong>Proofreading Done</strong>
            <p className="stat-number">{proofreadingDone.count ?? 0}</p>
          </div>

          <div>
            <strong>Literary Proofreading Done</strong>
            <p className="stat-number">{literaryProofreadingDone.count ?? 0}</p>
          </div>

          <div>
            <strong>Disqualified</strong>
            <p className="stat-number">{disqualified.count ?? 0}</p>
          </div>

          <div>
            <strong>Completed / Ready</strong>
            <p className="stat-number">{completed.count ?? 0}</p>
          </div>
        </div>
      </div>

      <AssignmentEngineClient />

      <div className="card" style={{ marginTop: 16 }}>
        <h2>User Import Template</h2>

        <p className="muted">
          Download the users import template with all supported user types,
          including ADEK Evaluator, Coordinator, General Proofreader, Literary
          Proofreader, Management, Reviewer, ADEK HQ, and Admin.
        </p>

        <div className="actions" style={{ marginTop: 12 }}>
          <a
            className="btn secondary"
            href="/templates/users_import_template.csv"
            download
          >
            Download Users Import Template
          </a>
        </div>
      </div>
    </main>
  );
}