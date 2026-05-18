import Link from "next/link";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { getCurrentUser, homeForRole } from "@/lib/auth";
import { getSubmissionFilterOptions } from "@/lib/filter-options";
import { firstParam } from "@/lib/pagination";
import { getFilteredSubmissionIds } from "@/lib/submission-query";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Role, WorkflowPhase } from "@/lib/types";
import { phaseLabels } from "@/lib/workflow";
import { WorkspaceClient } from "./workspace-client";

type QueueProps = {
  role: Role;
  phase: WorkflowPhase;
  title: string;
  startLabel: string;
  searchParams?: Record<string, string | string[] | undefined>;
  filterMode?: "standard" | "correction";
};

type KpiCard = {
  label: string;
  value: number;
};

const allAssignmentStatuses = [
  "assigned",
  "in_progress",
  "completed",
  "returned_for_correction",
  "sent_for_review",
];

const correctionReasonLabels: Record<string, string> = {
  adek_file_quality: "Artwork File Quality / Clarity Issue",
  artwork_mismatch: "Artwork Mismatch",
  incomplete_narrative: "Incomplete Narrative",
  inappropriate_flagged_content: "Inappropriate / Flagged Content",
  literary_needs_correction: "Literary Needs Correction",
};

const correctionSourceLabels: Record<string, string> = {
  adek_evaluation: "ADEK Evaluation",
  proofreading: "General Proofreading",
  literary_proofreading: "Literary Proofreading",
};

function formatViewLabel(view: string) {
  if (view === "not_completed") return "not completed";
  if (view === "returned_for_correction") return "returned for correction";
  if (view === "sent_for_correction") return "sent for correction";
  if (view === "sent_for_review") return "sent for review";
  if (view === "needs_review") return "needs review";

  return view.replaceAll("_", " ");
}

function isProofreadingPhase(phase: WorkflowPhase) {
  return phase === "proofreading" || phase === "literary_proofreading";
}

function statusesForView(phase: WorkflowPhase, view: string) {
  if (view === "all") return allAssignmentStatuses;

  if (view === "completed") return ["completed"];

  if (view === "approved" || view === "disqualified") {
    return ["completed"];
  }

  if (view === "needs_review") {
    return phase === "management_review"
      ? ["assigned", "in_progress"]
      : ["completed"];
  }

  if (view === "sent_for_review") return ["sent_for_review"];

  if (view === "sent_for_correction" || view === "returned_for_correction") {
    return ["returned_for_correction"];
  }

  return ["assigned", "in_progress"];
}

function defaultViewForPhase(phase: WorkflowPhase) {
  if (phase === "management_review") return "needs_review";
  return "not_completed";
}

function applySubmissionWorkflowGate(
  query: any,
  phase: WorkflowPhase,
  view: string
) {
  if (phase === "management_review") {
    if (view === "needs_review" || view === "not_completed") {
      return query.eq("submissions.workflow_status", "needs_management_review");
    }

    return query;
  }

  if (phase === "coordinator_check") {
    if (
      view === "not_completed" ||
      view === "sent_for_correction" ||
      view === "returned_for_correction"
    ) {
      return query.eq("submissions.workflow_status", "returned_for_correction");
    }

    return query;
  }

  if (phase === "adek_evaluation") {
    if (view === "sent_for_correction" || view === "returned_for_correction") {
      return query.eq("submissions.workflow_status", "returned_for_correction");
    }

    if (view === "not_completed") {
      return query.eq("submissions.workflow_status", "ready_for_adek");
    }

    return query;
  }

  if (!isProofreadingPhase(phase)) return query;

  if (view === "not_completed") {
    return query.eq("submissions.workflow_status", "selected_for_proofreading");
  }

  if (view === "sent_for_correction" || view === "returned_for_correction") {
    return query.eq("submissions.workflow_status", "returned_for_correction");
  }

  if (view === "sent_for_review") {
    return query.eq("submissions.workflow_status", "needs_management_review");
  }

  return query;
}

function applyDecisionGate(query: any, phase: WorkflowPhase, view: string) {
  if (view === "approved") return query.eq("decision", "approved");
  if (view === "disqualified") return query.eq("decision", "disqualified");

  if (view === "needs_review" && phase !== "management_review") {
    return query.eq("decision", "needs_review");
  }

  return query;
}

function applySourceGate(query: any, correctionSourcePhase?: string) {
  if (!correctionSourcePhase) return query;
  return query.eq("correction_source_phase", correctionSourcePhase);
}

function applyCoordinatorCorrectionSafetyGate(query: any, phase: WorkflowPhase) {
  if (phase !== "coordinator_check") return query;

  return query
    .eq("submissions.workflow_status", "returned_for_correction")
    .in("correction_source_phase", [
      "adek_evaluation",
      "proofreading",
      "literary_proofreading",
    ]);
}

function buildAssignmentCountQuery({
  userId,
  phase,
  view,
  correctionSourcePhase,
}: {
  userId: string;
  phase: WorkflowPhase;
  view: string;
  correctionSourcePhase?: string;
}) {
  const statuses = statusesForView(phase, view);

  let query = supabaseAdmin
    .from("assignments")
    .select("id,submissions!inner(id,workflow_status)", {
      count: "exact",
      head: true,
    })
    .eq("assigned_to", userId)
    .eq("phase", phase)
    .in("status", statuses);

  query = applySubmissionWorkflowGate(query, phase, view);
  query = applyDecisionGate(query, phase, view);
  query = applySourceGate(query, correctionSourcePhase);
  query = applyCoordinatorCorrectionSafetyGate(query, phase);

  return query;
}

async function getAssignmentCount({
  userId,
  phase,
  view,
  correctionSourcePhase,
}: {
  userId: string;
  phase: WorkflowPhase;
  view: string;
  correctionSourcePhase?: string;
}) {
  const { count, error } = await buildAssignmentCountQuery({
    userId,
    phase,
    view,
    correctionSourcePhase,
  });

  if (error) {
    console.error(`Count failed for ${phase}/${view}:`, error.message);
    return 0;
  }

  return count ?? 0;
}

async function getKpiCards({
  userId,
  phase,
}: {
  userId: string;
  phase: WorkflowPhase;
  proofreaderType?: string | null;
}): Promise<KpiCard[]> {
  if (phase === "adek_evaluation") {
    const [remaining, sentForCorrection, approved, needsReview, disqualified] =
      await Promise.all([
        getAssignmentCount({ userId, phase, view: "not_completed" }),
        getAssignmentCount({ userId, phase, view: "sent_for_correction" }),
        getAssignmentCount({ userId, phase, view: "approved" }),
        getAssignmentCount({ userId, phase, view: "needs_review" }),
        getAssignmentCount({ userId, phase, view: "disqualified" }),
      ]);

    return [
      { label: "Remaining", value: remaining },
      { label: "Sent for Correction", value: sentForCorrection },
      { label: "Approved", value: approved },
      { label: "Needs Review", value: needsReview },
      { label: "Disqualified", value: disqualified },
    ];
  }

  if (phase === "management_review") {
    const [remaining, approved, disqualified] = await Promise.all([
      getAssignmentCount({ userId, phase, view: "needs_review" }),
      getAssignmentCount({ userId, phase, view: "approved" }),
      getAssignmentCount({ userId, phase, view: "disqualified" }),
    ]);

    return [
      { label: "Needs Review", value: remaining },
      { label: "Approved by Me", value: approved },
      { label: "Disqualified by Me", value: disqualified },
    ];
  }

  if (phase === "proofreading") {
    const [remaining, sentForCorrection, completed] = await Promise.all([
      getAssignmentCount({ userId, phase, view: "not_completed" }),
      getAssignmentCount({ userId, phase, view: "sent_for_correction" }),
      getAssignmentCount({ userId, phase, view: "completed" }),
    ]);

    return [
      { label: "Remaining", value: remaining },
      { label: "Sent for Correction", value: sentForCorrection },
      { label: "Completed", value: completed },
    ];
  }

  if (phase === "literary_proofreading") {
    const [remaining, sentForReview, sentForCorrection, completed] =
      await Promise.all([
        getAssignmentCount({ userId, phase, view: "not_completed" }),
        getAssignmentCount({ userId, phase, view: "sent_for_review" }),
        getAssignmentCount({ userId, phase, view: "sent_for_correction" }),
        getAssignmentCount({ userId, phase, view: "completed" }),
      ]);

    return [
      { label: "Remaining", value: remaining },
      { label: "Sent for Review", value: sentForReview },
      { label: "Sent for Correction", value: sentForCorrection },
      { label: "Completed", value: completed },
    ];
  }

  if (phase === "coordinator_check") {
    const [remaining, fromAdek, fromGeneral, fromLiterary, completed] =
      await Promise.all([
        getAssignmentCount({ userId, phase, view: "not_completed" }),
        getAssignmentCount({
          userId,
          phase,
          view: "not_completed",
          correctionSourcePhase: "adek_evaluation",
        }),
        getAssignmentCount({
          userId,
          phase,
          view: "not_completed",
          correctionSourcePhase: "proofreading",
        }),
        getAssignmentCount({
          userId,
          phase,
          view: "not_completed",
          correctionSourcePhase: "literary_proofreading",
        }),
        getAssignmentCount({ userId, phase, view: "completed" }),
      ]);

    return [
      { label: "Remaining", value: remaining },
      { label: "From ADEK", value: fromAdek },
      { label: "From General Proofreader", value: fromGeneral },
      { label: "From Literary Proofreader", value: fromLiterary },
      { label: "Completed", value: completed },
    ];
  }

  if (phase === "final_review") {
    const [remaining, completed] = await Promise.all([
      getAssignmentCount({ userId, phase, view: "not_completed" }),
      getAssignmentCount({ userId, phase, view: "completed" }),
    ]);

    return [
      { label: "Remaining", value: remaining },
      { label: "Ready / Completed", value: completed },
    ];
  }

  const [remaining, completed] = await Promise.all([
    getAssignmentCount({ userId, phase, view: "not_completed" }),
    getAssignmentCount({ userId, phase, view: "completed" }),
  ]);

  return [
    { label: "Remaining", value: remaining },
    { label: "Completed", value: completed },
  ];
}

function ViewOptions({
  phase,
  isGeneralProofreader,
  isLiteraryProofreader,
}: {
  phase: WorkflowPhase;
  isGeneralProofreader: boolean;
  isLiteraryProofreader: boolean;
}) {
  if (phase === "management_review") {
    return (
      <>
        <option value="needs_review">Needs Review</option>
        <option value="approved">Approved</option>
        <option value="disqualified">Disqualified</option>
        <option value="all">All</option>
      </>
    );
  }

  if (phase === "adek_evaluation") {
    return (
      <>
        <option value="not_completed">Not Completed</option>
        <option value="sent_for_correction">Sent for Correction</option>
        <option value="approved">Approved</option>
        <option value="needs_review">Needs Review</option>
        <option value="disqualified">Disqualified</option>
        <option value="all">All</option>
      </>
    );
  }

  if (isLiteraryProofreader) {
    return (
      <>
        <option value="not_completed">Not Completed</option>
        <option value="sent_for_review">Sent for Review</option>
        <option value="sent_for_correction">Sent for Correction</option>
        <option value="completed">Completed</option>
        <option value="all">All</option>
      </>
    );
  }

  if (isGeneralProofreader) {
    return (
      <>
        <option value="not_completed">Not Completed</option>
        <option value="sent_for_correction">Sent for Correction</option>
        <option value="completed">Completed</option>
        <option value="all">All</option>
      </>
    );
  }

  return (
    <>
      <option value="not_completed">Not Completed</option>
      <option value="completed">Completed</option>
      <option value="all">All</option>
    </>
  );
}

export async function WorkQueuePage({
  role,
  phase,
  title,
  startLabel,
  searchParams = {},
  filterMode = "standard",
}: QueueProps) {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  if (user.role !== role && user.role !== "admin") {
    return (
      <main className="container">
        <Nav role={user.role} />

        <div className="card">
          <h1>Wrong Workspace</h1>

          <p className="muted">
            You are logged in as <strong>{user.role}</strong>, so this workspace
            is not available for your account.
          </p>

          <div className="actions" style={{ marginTop: 16 }}>
            <Link className="btn" href={homeForRole(user.role)}>
              Go to My Workspace
            </Link>

            <a className="btn secondary" href="/api/auth/logout">
              Logout
            </a>
          </div>
        </div>
      </main>
    );
  }

  const today = new Date().toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

  const defaultView = defaultViewForPhase(phase);
  const view = firstParam(searchParams.view, defaultView);
  const pathway = firstParam(searchParams.pathway);
  const correctionReason = firstParam(searchParams.correction_reason);
  const correctionSourcePhase = firstParam(searchParams.correction_source_phase);
  const search = firstParam(searchParams.search);

  const isGeneralProofreader =
    phase === "proofreading" &&
    (user.proofreader_type === "general" || user.role === "admin");

  const isLiteraryProofreader =
    phase === "literary_proofreading" &&
    (user.proofreader_type === "literary" || user.role === "admin");

  const isCoordinator = phase === "coordinator_check";

  const statuses = statusesForView(phase, view);

  const [options, kpiCards, filteredSubmissionIds] = await Promise.all([
    getSubmissionFilterOptions(),
    getKpiCards({
      userId: user.id,
      phase,
      proofreaderType: user.proofreader_type ?? null,
    }),
    getFilteredSubmissionIds({ pathway, search }),
  ]);

  let query = supabaseAdmin
    .from("assignments")
    .select(
      `
      id,
      phase,
      status,
      decision,
      created_at,
      started_at,
      completed_at,
      submission_id,
      requested_by_user_id,
      return_to_user_id,
      correction_reason,
      correction_notes,
      correction_source_phase,
      correction_source_assignment_id,
      proofreader_type,
      submissions!inner(*)
      `,
      { count: "exact" }
    )
    .eq("assigned_to", user.id)
    .eq("phase", phase)
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(250);

  query = applySubmissionWorkflowGate(query, phase, view);
  query = applyDecisionGate(query, phase, view);
  query = applySourceGate(query, correctionSourcePhase);
  query = applyCoordinatorCorrectionSafetyGate(query, phase);

  if (correctionReason) {
    query = query.eq("correction_reason", correctionReason);
  }

  if (filteredSubmissionIds && filteredSubmissionIds.length === 0) {
    query = query.eq("submission_id", "00000000-0000-0000-0000-000000000000");
  } else if (filteredSubmissionIds) {
    query = query.in("submission_id", filteredSubmissionIds);
  }

  const { data: assignmentData, count, error } = await query;
  const assignments = assignmentData ?? [];

  const submissionIds = Array.from(
    new Set(assignments.map((row: any) => row.submission_id).filter(Boolean))
  );

  const historyBySubmission: Record<string, any[]> = {};

  if (submissionIds.length) {
    const { data: historyRows } = await supabaseAdmin
      .from("assignments")
      .select(
        "id,submission_id,phase,status,decision,assigned_to,requested_by_user_id,return_to_user_id,correction_reason,correction_source_phase,created_at,completed_at,proofreader_type"
      )
      .in("submission_id", submissionIds)
      .order("created_at", { ascending: true });

    const profileIds = Array.from(
      new Set(
        (historyRows ?? [])
          .flatMap((row: any) => [
            row.assigned_to,
            row.requested_by_user_id,
            row.return_to_user_id,
          ])
          .filter(Boolean)
      )
    );

    const profileById: Record<string, any> = {};

    if (profileIds.length) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id,full_name,role,proofreader_type")
        .in("id", profileIds);

      for (const profile of profiles ?? []) {
        profileById[profile.id] = profile;
      }
    }

    for (const row of historyRows ?? []) {
      const enriched = {
        ...row,
        assigned_user: profileById[row.assigned_to] ?? null,
        requested_by_user: profileById[row.requested_by_user_id] ?? null,
        return_to_user: profileById[row.return_to_user_id] ?? null,
      };

      if (!historyBySubmission[row.submission_id]) {
        historyBySubmission[row.submission_id] = [];
      }

      historyBySubmission[row.submission_id].push(enriched);
    }
  }

  const enrichedAssignments = assignments.map((assignment: any) => ({
    ...assignment,
    task_history: historyBySubmission[assignment.submission_id] ?? [],
  }));

  const totalResults = count ?? 0;

  const kpiGridClass =
    kpiCards.length >= 5
      ? "grid grid-4"
      : kpiCards.length === 4
        ? "grid grid-4"
        : "grid grid-3";

  return (
    <main className="container">
      <Nav role={user.role} />

      <h1>{title}</h1>

      <div className={kpiGridClass}>
        <div className="card">
          <strong>Task Date</strong>
          <p className="stat-number">{today}</p>
        </div>

        {kpiCards.map((card) => (
          <div className="card" key={card.label}>
            <strong>{card.label}</strong>
            <p className="stat-number">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="card workspace-toolbar">
        <h2>Workspace Filters</h2>

        <form className="grid grid-4" action="" method="get">
          <label>
            <span className="small">Pathway</span>
            <select className="input" name="pathway" defaultValue={pathway}>
              <option value="">All pathways</option>
              {options.pathways.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          {filterMode === "correction" && (
            <label>
              <span className="small">Correction Reason</span>
              <select
                className="input"
                name="correction_reason"
                defaultValue={correctionReason}
              >
                <option value="">All reasons</option>
                {Object.entries(correctionReasonLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {isCoordinator && (
            <label>
              <span className="small">Correction Source</span>
              <select
                className="input"
                name="correction_source_phase"
                defaultValue={correctionSourcePhase}
              >
                <option value="">All sources</option>
                {Object.entries(correctionSourceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            <span className="small">View</span>
            <select className="input" name="view" defaultValue={view}>
              <ViewOptions
                phase={phase}
                isGeneralProofreader={isGeneralProofreader}
                isLiteraryProofreader={isLiteraryProofreader}
              />
            </select>
          </label>

          <label>
            <span className="small">Search</span>
            <input
              className="input"
              name="search"
              defaultValue={search}
              placeholder="Artwork name, reference, school"
            />
          </label>

          <button className="btn" type="submit">
            {startLabel}
          </button>
        </form>

        <div className="filter-summary">
          <span className="pill">Phase: {phaseLabels[phase]}</span>
          <span className="pill">Showing: {formatViewLabel(view)}</span>
          <span className="pill">Results: {totalResults}</span>
        </div>
      </div>

      {error ? (
        <div className="card">
          <h2>Workspace Error</h2>
          <p className="muted">{error.message}</p>
        </div>
      ) : (
        <WorkspaceClient
          phase={phase}
          role={role}
          assignments={enrichedAssignments}
          currentPath={`/${role === "evaluator" ? "evaluator/work" : role}`}
          proofreaderType={user.proofreader_type ?? null}
        />
      )}
    </main>
  );
}