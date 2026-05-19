import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireUser(["admin"]);

  const [
    submissions,
    activeAssignments,
    lastExport,
    readyForAdek,
    sentForCorrection,
    needsManagementReview,
    selectedForProofreading,
    proofreadingDone,
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
            <strong>Completed / Ready</strong>
            <p className="stat-number">{completed.count ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Workflow Maintenance</h2>

        <p className="muted">
          Use these tools only after importing new submissions or if a workflow
          task needs to be repaired. The normal workflow now creates Coordinator,
          Management, Proofreading, Literary Proofreading, and Reviewer tasks
          automatically.
        </p>

        <div className="grid grid-2">
          <div className="card" style={{ boxShadow: "none" }}>
            <h3>Assign Imported Submissions to ADEK Evaluators</h3>

            <p className="muted">
              Assigns newly imported submissions that are ready for ADEK
              evaluation to active ADEK evaluators. This is the main button
              needed after a fresh import.
            </p>

            <form action="/api/assignments/auto" method="post">
              <input type="hidden" name="phase" value="adek_evaluation" />

              <button className="btn" type="submit">
                Assign Imported Submissions
              </button>
            </form>
          </div>

          <div className="card" style={{ boxShadow: "none" }}>
            <h3>Repair Missing Assignments</h3>

            <p className="muted">
              Use only if a submission is in a workflow status but no active task
              was created. This attempts to repair eligible ADEK, Management,
              Proofreading, and Final Review queues without duplicating active
              assignments.
            </p>

            <form action="/api/assignments/auto" method="post">
              <input type="hidden" name="phase" value="repair_missing" />

              <button className="btn secondary" type="submit">
                Repair Missing Assignments
              </button>
            </form>
          </div>
        </div>
      </div>

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