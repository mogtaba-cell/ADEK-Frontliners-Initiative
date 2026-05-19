import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireUser(["admin"]);

  const [
    totalSubmissions,
    completedAdekEvaluations,
    totalSelected,
    totalDisqualified,
    activeCoordinatorCorrections,
    activeManagementReview,
    completedGeneralProofreading,
    completedLiteraryProofreading,
    completedFinalReviewReady,
    lastExport,
    evaluators,
  ] = await Promise.all([
    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true }),

    supabaseAdmin
      .from("assignments")
      .select("submission_id", { count: "exact", head: true })
      .eq("phase", "adek_evaluation")
      .eq("status", "completed")
      .not("completed_at", "is", null),

    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("evaluation_decision", "approved"),

    supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .or(
        "workflow_status.eq.disqualified,evaluation_decision.eq.disqualified,management_decision.eq.disqualified"
      ),

    supabaseAdmin
      .from("assignments")
      .select("submission_id", { count: "exact", head: true })
      .eq("phase", "coordinator_check")
      .in("status", ["assigned", "in_progress"]),

    supabaseAdmin
      .from("assignments")
      .select("submission_id", { count: "exact", head: true })
      .eq("phase", "management_review")
      .in("status", ["assigned", "in_progress"]),

    supabaseAdmin
      .from("assignments")
      .select("submission_id", { count: "exact", head: true })
      .eq("phase", "proofreading")
      .eq("status", "completed")
      .not("completed_at", "is", null),

    supabaseAdmin
      .from("assignments")
      .select("submission_id", { count: "exact", head: true })
      .eq("phase", "literary_proofreading")
      .eq("status", "completed")
      .not("completed_at", "is", null),

    supabaseAdmin
      .from("assignments")
      .select("submission_id", { count: "exact", head: true })
      .eq("phase", "final_review")
      .eq("status", "completed")
      .not("completed_at", "is", null),

    supabaseAdmin
      .from("export_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1),

    supabaseAdmin
      .from("profiles")
      .select("id,full_name,email")
      .eq("role", "evaluator")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
  ]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <h1>Admin Dashboard</h1>

      <div className="grid grid-3">
        <div className="card">
          <h2>Total Submissions</h2>
          <p className="stat-number">{totalSubmissions.count ?? 0}</p>
        </div>

        <div className="card">
          <h2>Completed ADEK Evaluations</h2>
          <p className="stat-number">{completedAdekEvaluations.count ?? 0}</p>
        </div>

        <div className="card">
          <h2>Last Export</h2>
          <p>{lastExport.data?.[0]?.status ?? "No exports yet"}</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Workflow Overview</h2>

        <p className="muted">
          These live counts come from the current assignment state, so they stay
          accurate after reassignment and repair actions.
        </p>

        <div className="grid grid-3">
          <div>
            <strong>Total Submissions</strong>
            <p className="stat-number">{totalSubmissions.count ?? 0}</p>
          </div>

          <div>
            <strong>Completed ADEK evaluations</strong>
            <p className="stat-number">{completedAdekEvaluations.count ?? 0}</p>
          </div>

          <div>
            <strong>Total Selected</strong>
            <p className="stat-number">{totalSelected.count ?? 0}</p>
          </div>

          <div>
            <strong>Total Disqualified</strong>
            <p className="stat-number">{totalDisqualified.count ?? 0}</p>
          </div>

          <div>
            <strong>Active coordinator corrections</strong>
            <p className="stat-number">{activeCoordinatorCorrections.count ?? 0}</p>
          </div>

          <div>
            <strong>Active management review</strong>
            <p className="stat-number">{activeManagementReview.count ?? 0}</p>
          </div>

          <div>
            <strong>Completed general proofreading</strong>
            <p className="stat-number">{completedGeneralProofreading.count ?? 0}</p>
          </div>

          <div>
            <strong>Completed literary proofreading</strong>
            <p className="stat-number">{completedLiteraryProofreading.count ?? 0}</p>
          </div>

          <div>
            <strong>Completed final review / ready</strong>
            <p className="stat-number">{completedFinalReviewReady.count ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Workflow Maintenance</h2>

        <p className="muted">
          Import only adds submissions. Select evaluators here to assign new
          imported submissions. Repair Missing Assignments does not assign ADEK
          evaluator or management tasks.
        </p>

        <div className="grid grid-2">
          <div className="card" style={{ boxShadow: "none" }}>
            <h3>Assign Imported Submissions to ADEK Evaluators</h3>

            <p className="muted">
              Select the evaluators who should receive imported submissions.
              Work will be distributed evenly only between the selected
              evaluators.
            </p>

            <form action="/api/assignments/auto" method="post">
              <input type="hidden" name="phase" value="adek_evaluation" />
              <input type="hidden" name="limit" value="5000" />

              <div
                className="card"
                style={{
                  boxShadow: "none",
                  marginTop: 12,
                  maxHeight: 320,
                  overflowY: "auto",
                }}
              >
                <strong>Select Evaluators</strong>

                <div className="grid grid-2" style={{ marginTop: 12 }}>
                  {(evaluators.data ?? []).map((evaluator) => (
                    <label
                      key={evaluator.id}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "flex-start",
                      }}
                    >
                      <input
                        type="checkbox"
                        name="evaluator_ids"
                        value={evaluator.id}
                      />

                      <span>
                        <strong>{evaluator.full_name}</strong>
                        <br />
                        <span className="muted small">{evaluator.email}</span>
                      </span>
                    </label>
                  ))}
                </div>

                {(evaluators.data ?? []).length === 0 && (
                  <p className="muted">No active evaluators found.</p>
                )}
              </div>

              <button className="btn" type="submit" style={{ marginTop: 12 }}>
                Assign Imported Submissions
              </button>
            </form>
          </div>

          <div className="card" style={{ boxShadow: "none" }}>
            <h3>Repair Missing Assignments</h3>

            <p className="muted">
              Repairs missing tasks for Coordinators, General Proofreaders,
              Literary Proofreaders, and Reviewers only.
            </p>

            <form action="/api/assignments/auto" method="post">
              <input type="hidden" name="phase" value="repair_missing" />
              <input type="hidden" name="limit" value="5000" />

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
