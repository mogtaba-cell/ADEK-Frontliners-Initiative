import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  countUnassignedAdekSubmissions,
  getEvaluatorAssignmentWorkloads,
} from "@/lib/assignment";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function countSubmissions(filters?: (query: any) => any) {
  let query = supabaseAdmin.from("submissions").select("id", {
    count: "exact",
    head: true,
  });
  if (filters) query = filters(query);
  const { count, error } = await query;
  if (error) {
    console.error("Admin submission count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function countAssignments(filters: (query: any) => any) {
  let query = supabaseAdmin.from("assignments").select("submission_id", {
    count: "exact",
    head: true,
  });
  query = filters(query);
  const { count, error } = await query;
  if (error) {
    console.error("Admin assignment count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function getDashboardCounts() {
  const [
    totalSubmissions,
    completedAdekEvaluations,
    totalSelected,
    totalDisqualified,
    activeCoordinatorCorrections,
    activeManagementReview,
    completedGeneralProofreading,
    completedLiteraryProofreading,
    completedFinalReady,
    lastExport,
    activeAssignments,
  ] = await Promise.all([
    countSubmissions(),
    countAssignments((query) =>
      query
        .eq("phase", "adek_evaluation")
        .eq("status", "completed")
        .not("completed_at", "is", null)
    ),
    countSubmissions((query) =>
      query
        .eq("evaluation_decision", "approved")
        .neq("workflow_status", "disqualified")
    ),
    countSubmissions((query) =>
      query.or(
        "workflow_status.eq.disqualified,evaluation_decision.eq.disqualified,management_decision.eq.disqualified"
      )
    ),
    countAssignments((query) =>
      query.eq("phase", "coordinator_check").in("status", ["assigned", "in_progress"])
    ),
    countAssignments((query) =>
      query.eq("phase", "management_review").in("status", ["assigned", "in_progress"])
    ),
    countAssignments((query) =>
      query
        .eq("phase", "proofreading")
        .eq("status", "completed")
        .not("completed_at", "is", null)
    ),
    countAssignments((query) =>
      query
        .eq("phase", "literary_proofreading")
        .eq("status", "completed")
        .not("completed_at", "is", null)
    ),
    countAssignments((query) =>
      query
        .eq("phase", "final_review")
        .eq("status", "completed")
        .not("completed_at", "is", null)
    ),
    supabaseAdmin
      .from("export_batches")
      .select("id,status,mode,destination_folder_id,error_message,created_at,completed_at")
      .order("created_at", { ascending: false })
      .limit(1),
    countAssignments((query) =>
      query.in("status", [
        "assigned",
        "in_progress",
        "returned_for_correction",
        "sent_for_review",
      ])
    ),
  ]);

  return {
    totalSubmissions,
    completedAdekEvaluations,
    totalSelected,
    totalDisqualified,
    activeCoordinatorCorrections,
    activeManagementReview,
    completedGeneralProofreading,
    completedLiteraryProofreading,
    completedFinalReady,
    lastExport,
    activeAssignments,
  };
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const user = await requireUser(["admin"]);
  const params = (await searchParams) ?? {};
  const maintenance = firstParam(params.maintenance);
  const maintenanceError = firstParam(params.maintenance_error);

  const [dashboard, unassignedAdekCount, evaluators] = await Promise.all([
    getDashboardCounts(),
    countUnassignedAdekSubmissions(),
    getEvaluatorAssignmentWorkloads(),
  ]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <h1>Admin Dashboard</h1>

      {maintenance && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="pill">Workflow Maintenance Completed: {maintenance}</p>
          <p className="muted small" style={{ marginTop: 6 }}>
            Assigned: {firstParam(params.assigned) ?? "0"} | Skipped: {firstParam(params.skipped) ?? "0"}
            {firstParam(params.errors) ? ` | Errors: ${firstParam(params.errors)}` : ""}
          </p>
        </div>
      )}

      {maintenanceError && (
        <div
          className="card"
          style={{ marginBottom: 16, background: "#fff1f1", border: "1px solid #d88" }}
        >
          <strong>Error:</strong> <span className="muted">{maintenanceError}</span>
        </div>
      )}

      <div className="grid grid-3">
        <div className="card">
          <h2>Total Submissions</h2>
          <p className="stat-number">{dashboard.totalSubmissions}</p>
        </div>

        <div className="card">
          <h2>Active Assignments</h2>
          <p className="stat-number">{dashboard.activeAssignments}</p>
        </div>

        <div className="card">
          <h2>Last Export</h2>
          <p>{dashboard.lastExport.data?.[0]?.status ?? "No exports yet"}</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Workflow Overview</h2>
        <p className="muted">
          These counts are based on assignment records and final decisions, not only workflow labels.
        </p>

        <div className="grid grid-4">
          <div>
            <strong>Total Submissions</strong>
            <p className="stat-number">{dashboard.totalSubmissions}</p>
          </div>

          <div>
            <strong>Completed ADEK evaluations</strong>
            <p className="stat-number">{dashboard.completedAdekEvaluations}</p>
          </div>

          <div>
            <strong>Total Selected</strong>
            <p className="stat-number">{dashboard.totalSelected}</p>
          </div>

          <div>
            <strong>Total Disqualified</strong>
            <p className="stat-number">{dashboard.totalDisqualified}</p>
          </div>

          <div>
            <strong>Active coordinator corrections</strong>
            <p className="stat-number">{dashboard.activeCoordinatorCorrections}</p>
          </div>

          <div>
            <strong>Active management review</strong>
            <p className="stat-number">{dashboard.activeManagementReview}</p>
          </div>

          <div>
            <strong>Completed general proofreading</strong>
            <p className="stat-number">{dashboard.completedGeneralProofreading}</p>
          </div>

          <div>
            <strong>Completed literary proofreading</strong>
            <p className="stat-number">{dashboard.completedLiteraryProofreading}</p>
          </div>

          <div>
            <strong>Completed final review / ready</strong>
            <p className="stat-number">{dashboard.completedFinalReady}</p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Workflow Maintenance</h2>
        <p className="muted">
          Imported submissions are not assigned automatically. Enter the exact number of new unassigned artworks each evaluator should receive.
        </p>

        <div className="grid grid-2">
          <div className="card" style={{ boxShadow: "none" }}>
            <h3>Assign Imported Submissions to ADEK Evaluators</h3>
            <p className="muted">
              Unassigned artworks waiting for ADEK evaluation: <strong>{unassignedAdekCount}</strong>
            </p>

            <form action="/api/assignments/auto" method="post">
              <input type="hidden" name="phase" value="adek_evaluation" />

              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Evaluator</th>
                      <th>Current assigned total</th>
                      <th>Current remaining</th>
                      <th>New artworks to assign</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluators.map((evaluator) => (
                      <tr key={evaluator.id}>
                        <td>
                          <strong>{evaluator.full_name}</strong>
                          <div className="muted small">{evaluator.email}</div>
                        </td>
                        <td>{evaluator.assigned_total}</td>
                        <td>{evaluator.remaining}</td>
                        <td>
                          <input
                            className="input compact-input"
                            type="number"
                            min="0"
                            max={unassignedAdekCount}
                            name={`quantity_${evaluator.id}`}
                            defaultValue="0"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button className="btn" type="submit" style={{ marginTop: 12 }}>
                Assign Exact Quantities
              </button>
            </form>
          </div>

          <div className="card" style={{ boxShadow: "none" }}>
            <h3>Repair Missing Assignments</h3>
            <p className="muted">
              Repair non-evaluator queues only. These buttons do not create ADEK evaluator assignments.
            </p>

            <div className="grid" style={{ gap: 12, marginTop: 16 }}>
              {[
                {
                  phase: "coordinator_check",
                  title: "Coordinator corrections",
                  description: "Assigns active returned-for-correction submissions to coordinators.",
                },
                {
                  phase: "management_review",
                  title: "Management review",
                  description: "Assigns active needs-management-review submissions to management users.",
                },
                {
                  phase: "proofreading",
                  title: "General proofreading",
                  description: "Assigns approved selected artworks to general proofreaders when missing.",
                },
                {
                  phase: "literary_proofreading",
                  title: "Literary proofreading",
                  description: "Assigns approved literary artworks to the correct literary proofreader type when language is classified.",
                },
                {
                  phase: "final_review",
                  title: "Final review",
                  description: "Assigns artworks to reviewers only after all required previous stages are completed.",
                },
              ].map((item) => (
                <form
                  action="/api/assignments/auto"
                  method="post"
                  key={item.phase}
                  className="card"
                  style={{ boxShadow: "none", padding: 14 }}
                >
                  <input type="hidden" name="phase" value={item.phase} />
                  <strong>{item.title}</strong>
                  <p className="muted small" style={{ marginTop: 6 }}>
                    {item.description}
                  </p>
                  <button className="btn secondary" type="submit">
                    Repair {item.title}
                  </button>
                </form>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>User Import Template</h2>
        <p className="muted">
          Download the users import template with all supported user types.
        </p>
        <div className="actions" style={{ marginTop: 12 }}>
          <a className="btn secondary" href="/templates/users_import_template.csv" download>
            Download Users Import Template
          </a>
        </div>
      </div>
    </main>
  );
}
