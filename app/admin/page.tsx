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


const KPI_PAGE_SIZE = 1000;

type SubmissionSummaryRow = {
  id: string;
  workflow_status?: string | null;
  evaluation_decision?: string | null;
  management_decision?: string | null;
};

type AssignmentSummaryRow = {
  submission_id: string | null;
  phase?: string | null;
  proofreader_type?: string | null;
  status?: string | null;
  decision?: string | null;
};

async function fetchAllSubmissionSummaries() {
  const rows: SubmissionSummaryRow[] = [];

  for (let from = 0; ; from += KPI_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("submissions")
      .select("id,workflow_status,evaluation_decision,management_decision")
      .order("created_at", { ascending: true })
      .range(from, from + KPI_PAGE_SIZE - 1);

    if (error) {
      console.error("Admin KPI submissions query failed:", error.message);
      return rows;
    }

    rows.push(...((data ?? []) as SubmissionSummaryRow[]));
    if (!data || data.length < KPI_PAGE_SIZE) break;
  }

  return rows;
}

async function fetchAllAssignmentSummaries() {
  const rows: AssignmentSummaryRow[] = [];

  for (let from = 0; ; from += KPI_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("assignments")
      .select("submission_id,phase,proofreader_type,status,decision")
      .order("created_at", { ascending: true })
      .range(from, from + KPI_PAGE_SIZE - 1);

    if (error) {
      console.error("Admin KPI assignments query failed:", error.message);
      return rows;
    }

    rows.push(...((data ?? []) as AssignmentSummaryRow[]));
    if (!data || data.length < KPI_PAGE_SIZE) break;
  }

  return rows;
}

function hasAdekFinalityDecision(rows: AssignmentSummaryRow[]) {
  return rows.some((row) => {
    if (row.phase !== "adek_evaluation") return false;

    return (
      (row.status === "completed" && Boolean(row.decision)) ||
      (row.status === "returned_for_correction" && row.decision === "needs_correction")
    );
  });
}

function hasApprovalDecision(rows: AssignmentSummaryRow[], submission: SubmissionSummaryRow) {
  if (submission.evaluation_decision === "approved") return true;
  if (submission.management_decision === "approved") return true;

  return rows.some((row) => {
    if (row.status !== "completed") return false;
    if (row.phase === "adek_evaluation") {
      return row.decision === "approved" || row.decision === "approved_by_management";
    }
    if (row.phase === "management_review") {
      return row.decision === "approved" || row.decision === "approved_by_management";
    }
    return false;
  });
}


function calculateWorkflowKpis(
  submissions: SubmissionSummaryRow[],
  assignments: AssignmentSummaryRow[]
) {
  const assignmentsBySubmission = new Map<string, AssignmentSummaryRow[]>();

  for (const assignment of assignments) {
    if (!assignment.submission_id) continue;
    const existing = assignmentsBySubmission.get(assignment.submission_id) ?? [];
    existing.push(assignment);
    assignmentsBySubmission.set(assignment.submission_id, existing);
  }

  let completedAdekEvaluations = 0;
  let totalSelected = 0;
  let activeManagementReview = 0;
  let totalDisqualified = 0;
  let activeCoordinatorCorrections = 0;
  let completedGeneralProofreading = 0;
  let completedLiteraryProofreading = 0;
  let completedFinalReady = 0;

  for (const submission of submissions) {
    const rows = assignmentsBySubmission.get(submission.id) ?? [];

    if (hasAdekFinalityDecision(rows)) completedAdekEvaluations += 1;
    if (submission.workflow_status === "needs_management_review") activeManagementReview += 1;
    if (submission.workflow_status === "disqualified") totalDisqualified += 1;

    if (
      submission.workflow_status === "returned_for_correction" &&
      rows.some(
        (row) =>
          row.phase === "coordinator_check" &&
          (row.status === "assigned" || row.status === "in_progress")
      )
    ) {
      activeCoordinatorCorrections += 1;
    }

    if (
      rows.some(
        (row) =>
          row.phase === "proofreading" &&
          row.proofreader_type === "general" &&
          row.status === "completed" &&
          row.decision === "completed"
      )
    ) {
      completedGeneralProofreading += 1;
    }

    if (
      rows.some(
        (row) =>
          row.phase === "literary_proofreading" &&
          row.status === "completed" &&
          row.decision === "completed"
      )
    ) {
      completedLiteraryProofreading += 1;
    }

    if (
      rows.some(
        (row) =>
          row.phase === "final_review" &&
          row.status === "completed" &&
          row.decision === "completed"
      )
    ) {
      completedFinalReady += 1;
    }

    const isInSelectedPipeline =
      submission.workflow_status === "selected_for_proofreading" ||
      submission.workflow_status === "proofreading_done" ||
      submission.workflow_status === "completed";

    // Total Selected only counts submissions still in the selected/final pipeline.
    // If a literary proofreader disqualifies an artwork, workflow_status becomes
    // disqualified, so it is removed from Total Selected and counted under Total Disqualified.
    if (isInSelectedPipeline && hasApprovalDecision(rows, submission)) {
      totalSelected += 1;
    }
  }

  const activeAssignments = assignments.filter(
    (row) => row.status === "assigned" || row.status === "in_progress"
  ).length;

  return {
    totalSubmissions: submissions.length,
    completedAdekEvaluations,
    totalSelected,
    totalDisqualified,
    activeCoordinatorCorrections,
    activeManagementReview,
    completedGeneralProofreading,
    completedLiteraryProofreading,
    completedFinalReady,
    activeAssignments,
  };
}

async function getDashboardCounts() {
  const [submissions, assignments, lastExport] = await Promise.all([
    fetchAllSubmissionSummaries(),
    fetchAllAssignmentSummaries(),
    supabaseAdmin
      .from("export_batches")
      .select("id,status,mode,destination_folder_id,error_message,created_at,completed_at")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  return {
    ...calculateWorkflowKpis(submissions, assignments),
    lastExport,
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
            <strong>ADEK Evaluated</strong>
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
            <strong>Sent Corrections</strong>
            <p className="stat-number">{dashboard.activeCoordinatorCorrections}</p>
          </div>

          <div>
            <strong>Needs Mgmt</strong>
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
            <strong>Completed Final</strong>
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
