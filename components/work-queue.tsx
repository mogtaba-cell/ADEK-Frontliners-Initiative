import Link from "next/link";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { getCurrentUser, homeForRole } from "@/lib/auth";
import { getSubmissionFilterOptions } from "@/lib/filter-options";
import { firstParam } from "@/lib/pagination";
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

type SchoolOption = {
  value: string;
  label: string;
};

const allAssignmentStatuses = [
  "assigned",
  "in_progress",
  "completed",
  "returned_for_correction",
  "sent_for_review",
];

const WORKSPACE_PAGE_SIZE = 1000;

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
  management_review: "Management Review",
  final_review: "Review",
  categorization: "Categorization",
  artistic_ranking: "Artistic Ranking",
};

function schoolOptionFromSubmission(submission: any): SchoolOption {
  const schoolName = String(submission?.institution_name ?? "").trim();
  const schoolRef = String(submission?.institution_ref_number ?? "").trim();

  if (schoolRef) {
    return {
      value: `ref:${schoolRef}`,
      label: schoolName ? `${schoolName} (${schoolRef})` : schoolRef,
    };
  }

  if (schoolName) {
    return {
      value: `name:${schoolName}`,
      label: schoolName,
    };
  }

  return {
    value: "unknown",
    label: "Unknown School",
  };
}

function matchesSchoolOptionValue(submission: any, value: string) {
  const schoolName = String(submission?.institution_name ?? "").trim();
  const schoolRef = String(submission?.institution_ref_number ?? "").trim();

  if (value === "unknown") return !schoolName && !schoolRef;
  if (value.startsWith("ref:")) return schoolRef === value.slice(4);
  if (value.startsWith("name:")) return schoolName === value.slice(5);

  // Backward compatibility for any old URL that still has free-text school search.
  return schoolName.toLowerCase().includes(value.toLowerCase());
}

async function fetchCoordinatorSchoolAssignmentRows(userId: string) {
  const rows: any[] = [];

  for (let from = 0; ; from += WORKSPACE_PAGE_SIZE) {
    const to = from + WORKSPACE_PAGE_SIZE - 1;

    const { data, error } = await supabaseAdmin
      .from("assignments")
      .select(
        `
        submission_id,
        submissions!inner(
          institution_name,
          institution_ref_number
        )
        `,
      )
      .eq("assigned_to", userId)
      .eq("phase", "coordinator_check")
      .in("status", allAssignmentStatuses)
      .range(from, to);

    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < WORKSPACE_PAGE_SIZE) break;
  }

  return rows;
}

async function getCoordinatorSchoolOptions(
  userId: string,
): Promise<SchoolOption[]> {
  const rows = await fetchCoordinatorSchoolAssignmentRows(userId);
  const schools = new Map<string, SchoolOption>();

  for (const row of rows) {
    const submission = Array.isArray((row as any).submissions)
      ? (row as any).submissions[0]
      : (row as any).submissions;

    const option = schoolOptionFromSubmission(submission);
    schools.set(option.value, option);
  }

  return Array.from(schools.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

function applySchoolGate(query: any, schoolValue: string) {
  if (!schoolValue) return query;

  if (schoolValue === "unknown") {
    return query
      .is("submissions.institution_name", null)
      .is("submissions.institution_ref_number", null);
  }

  if (schoolValue.startsWith("ref:")) {
    return query.eq("submissions.institution_ref_number", schoolValue.slice(4));
  }

  if (schoolValue.startsWith("name:")) {
    return query.eq("submissions.institution_name", schoolValue.slice(5));
  }

  // Backward compatibility for older URLs that still hold free-text school filters.
  return query.ilike("submissions.institution_name", `%${schoolValue}%`);
}

function safeFirstParam(
  value: string | string[] | undefined,
  fallback = "",
): string {
  return firstParam(value) || fallback;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function pathForWorkspaceRole(role: Role) {
  if (role === "evaluator") return "/evaluator/work";
  if (role === "management") return "/management/work";
  return `/${role}`;
}

function buildReturnPath(
  role: Role,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "refresh") continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== "") params.append(key, item);
      }
      continue;
    }

    if (value !== undefined && value !== "") params.set(key, value);
  }

  const query = params.toString();
  const path = pathForWorkspaceRole(role);
  return query ? `${path}?${query}` : path;
}

function formatViewLabel(view: string) {
  if (view === "not_completed") return "not completed";
  if (view === "returned_for_correction") return "returned for correction";
  if (view === "sent_for_correction") return "sent for correction";
  if (view === "sent_for_review") return "sent for review";
  if (view === "needs_review") return "needs review";
  if (view === "waiting_for_response") return "waiting for response";

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

  if (view === "waiting_for_response") return ["assigned", "in_progress"];

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
  _phase: WorkflowPhase,
  _view: string,
) {
  // Workspaces intentionally do not hide valid assignments based on submission.workflow_status.
  // The assignment row is the source of truth for ownership and user-visible tasks.
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

function applyCoordinatorWaitingGate(
  query: any,
  phase: WorkflowPhase,
  view: string,
) {
  if (phase === "coordinator_check" && view === "waiting_for_response") {
    return query.eq("coordinator_waiting_for_response", true);
  }

  return query;
}

function applyCoordinatorCorrectionSafetyGate(
  query: any,
  _phase: WorkflowPhase,
) {
  return query;
}

function applyProofreaderTypeGate(
  query: any,
  phase: WorkflowPhase,
  proofreaderType?: string | null,
) {
  if (!proofreaderType) return query;

  if (phase === "proofreading" || phase === "literary_proofreading") {
    return query.eq("proofreader_type", proofreaderType);
  }

  return query;
}

function buildAssignmentRowsQuery({
  userId,
  phase,
  view,
  statuses,
  correctionSourcePhase,
  proofreaderType,
  correctionReason,
  pathway,
  school,
  search,
  from,
  to,
}: {
  userId: string;
  phase: WorkflowPhase;
  view: string;
  statuses: string[];
  correctionSourcePhase?: string;
  proofreaderType?: string | null;
  correctionReason?: string;
  pathway?: string;
  school?: string;
  search?: string;
  from: number;
  to: number;
}) {
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
      coordinator_comment,
      coordinator_waiting_for_response,
      coordinator_waiting_for_response_at,
      submissions!inner(*)
      `,
      { count: "exact" },
    )
    .eq("assigned_to", userId)
    .eq("phase", phase)
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .range(from, to);

  query = applySubmissionWorkflowGate(query, phase, view);
  query = applyDecisionGate(query, phase, view);
  query = applySourceGate(query, correctionSourcePhase);
  query = applyCoordinatorWaitingGate(query, phase, view);
  query = applyCoordinatorCorrectionSafetyGate(query, phase);
  query = applyProofreaderTypeGate(query, phase, proofreaderType);

  if (correctionReason) {
    query = query.eq("correction_reason", correctionReason);
  }

  if (pathway) {
    query = query.eq("submissions.art_pathway_name_en", pathway);
  }

  if (school) {
    query = applySchoolGate(query, school);
  }

  if (search && search.trim().length >= 2) {
    const q = search.trim().replaceAll("%", "");

    query = query.or(
      `reference_id.ilike.%${q}%,institution_name.ilike.%${q}%,artwork_title_en.ilike.%${q}%,artwork_title_ar.ilike.%${q}%`,
      { foreignTable: "submissions" },
    );
  }

  return query;
}

async function fetchAllAssignmentRows({
  userId,
  phase,
  view,
  statuses,
  correctionSourcePhase,
  proofreaderType,
  correctionReason,
  pathway,
  school,
  search,
}: {
  userId: string;
  phase: WorkflowPhase;
  view: string;
  statuses: string[];
  correctionSourcePhase?: string;
  proofreaderType?: string | null;
  correctionReason?: string;
  pathway?: string;
  school?: string;
  search?: string;
}) {
  const rows: any[] = [];
  let totalResults = 0;

  for (let from = 0; ; from += WORKSPACE_PAGE_SIZE) {
    const to = from + WORKSPACE_PAGE_SIZE - 1;

    const { data, count, error } = await buildAssignmentRowsQuery({
      userId,
      phase,
      view,
      statuses,
      correctionSourcePhase,
      proofreaderType,
      correctionReason,
      pathway,
      school,
      search,
      from,
      to,
    });

    if (error) {
      return {
        rows,
        count: totalResults,
        error,
      };
    }

    const page = data ?? [];

    if (from === 0) {
      totalResults = count ?? page.length;
    }

    rows.push(...page);

    if (page.length < WORKSPACE_PAGE_SIZE) break;
    if (totalResults > 0 && rows.length >= totalResults) break;
  }

  return {
    rows,
    count: totalResults || rows.length,
    error: null,
  };
}

function buildAssignmentCountQuery({
  userId,
  phase,
  view,
  correctionSourcePhase,
  proofreaderType,
}: {
  userId: string;
  phase: WorkflowPhase;
  view: string;
  correctionSourcePhase?: string;
  proofreaderType?: string | null;
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
  query = applyCoordinatorWaitingGate(query, phase, view);
  query = applyCoordinatorCorrectionSafetyGate(query, phase);
  query = applyProofreaderTypeGate(query, phase, proofreaderType);

  return query;
}

async function getAssignmentCount({
  userId,
  phase,
  view,
  correctionSourcePhase,
  proofreaderType,
}: {
  userId: string;
  phase: WorkflowPhase;
  view: string;
  correctionSourcePhase?: string;
  proofreaderType?: string | null;
}) {
  const { count, error } = await buildAssignmentCountQuery({
    userId,
    phase,
    view,
    correctionSourcePhase,
    proofreaderType,
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
  proofreaderType,
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
      getAssignmentCount({
        userId,
        phase,
        view: "not_completed",
        proofreaderType,
      }),
      getAssignmentCount({
        userId,
        phase,
        view: "sent_for_correction",
        proofreaderType,
      }),
      getAssignmentCount({
        userId,
        phase,
        view: "completed",
        proofreaderType,
      }),
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
        getAssignmentCount({
          userId,
          phase,
          view: "not_completed",
          proofreaderType,
        }),
        getAssignmentCount({
          userId,
          phase,
          view: "sent_for_review",
          proofreaderType,
        }),
        getAssignmentCount({
          userId,
          phase,
          view: "sent_for_correction",
          proofreaderType,
        }),
        getAssignmentCount({
          userId,
          phase,
          view: "completed",
          proofreaderType,
        }),
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
      { label: "Review Completed", value: completed },
    ];
  }

  if (phase === "categorization" || phase === "artistic_ranking") {
    const [remaining, completed] = await Promise.all([
      getAssignmentCount({ userId, phase, view: "not_completed" }),
      getAssignmentCount({ userId, phase, view: "completed" }),
    ]);

    return [
      { label: "Remaining", value: remaining },
      { label: "Completed", value: completed },
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
  if (phase === "coordinator_check") {
    return (
      <>
        <option value="not_completed">Not Completed</option>
        <option value="waiting_for_response">Waiting for Response</option>
        <option value="completed">Completed</option>
        <option value="all">All</option>
      </>
    );
  }

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
  const view = safeFirstParam(searchParams.view, defaultView);
  const pathway = safeFirstParam(searchParams.pathway);
  const correctionReason = safeFirstParam(searchParams.correction_reason);
  const correctionSourcePhase = safeFirstParam(
    searchParams.correction_source_phase,
  );
  const school = safeFirstParam(searchParams.school);
  const search = safeFirstParam(searchParams.search);

  const isGeneralProofreader =
    phase === "proofreading" &&
    (user.proofreader_type === "general" || user.role === "admin");

  const isLiteraryProofreader =
    phase === "literary_proofreading" &&
    (user.proofreader_type === "literary" ||
      user.proofreader_type === "literary_arabic" ||
      user.proofreader_type === "literary_english_or_others" ||
      user.role === "admin");

  const isCoordinator = phase === "coordinator_check";
  const statuses = statusesForView(phase, view);

  const [options, kpiCards, coordinatorSchoolOptions] = await Promise.all([
    getSubmissionFilterOptions(),
    getKpiCards({
      userId: user.id,
      phase,
      proofreaderType: user.proofreader_type ?? null,
    }),
    isCoordinator ? getCoordinatorSchoolOptions(user.id) : Promise.resolve([]),
  ]);

  const {
    rows: assignments,
    count,
    error,
  } = await fetchAllAssignmentRows({
    userId: user.id,
    phase,
    view,
    statuses,
    correctionSourcePhase,
    proofreaderType: user.proofreader_type ?? null,
    correctionReason,
    pathway,
    school: isCoordinator ? school : "",
    search,
  });

  const submissionIds = Array.from(
    new Set(assignments.map((row: any) => row.submission_id).filter(Boolean)),
  );

  const historyBySubmission: Record<string, any[]> = {};

  if (submissionIds.length) {
    const historyRows: any[] = [];

    // Keep each .in(...) request small. Large arrays create very long
    // PostgREST URLs and can trigger HeadersOverflowError / Bad Request.
    for (const submissionIdChunk of chunkArray(submissionIds, 200)) {
      const { data: chunkHistoryRows, error: historyError } =
        await supabaseAdmin
          .from("assignments")
          .select(
            "id,submission_id,phase,status,decision,assigned_to,requested_by_user_id,return_to_user_id,correction_reason,correction_source_phase,created_at,completed_at,proofreader_type",
          )
          .in("submission_id", submissionIdChunk)
          .order("created_at", { ascending: true });

      if (historyError) {
        console.error("Workspace history query failed:", historyError.message);
        continue;
      }

      historyRows.push(...(chunkHistoryRows ?? []));
    }

    const profileIds = Array.from(
      new Set(
        historyRows
          .flatMap((row: any) => [
            row.assigned_to,
            row.requested_by_user_id,
            row.return_to_user_id,
          ])
          .filter(Boolean),
      ),
    );

    const profileById: Record<string, any> = {};

    for (const profileIdChunk of chunkArray(profileIds, 200)) {
      const { data: profiles, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id,full_name,role,proofreader_type")
        .in("id", profileIdChunk);

      if (profileError) {
        console.error("Workspace profile query failed:", profileError.message);
        continue;
      }

      for (const profile of profiles ?? []) {
        profileById[profile.id] = profile;
      }
    }

    for (const row of historyRows) {
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

          {isCoordinator && (
            <label>
              <span className="small">School Name</span>
              <select className="input" name="school" defaultValue={school}>
                <option value="">All schools</option>
                {coordinatorSchoolOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {filterMode === "correction" && (
            <label>
              <span className="small">Correction Reason</span>
              <select
                className="input"
                name="correction_reason"
                defaultValue={correctionReason}
              >
                <option value="">All reasons</option>
                {Object.entries(correctionReasonLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
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
                {Object.entries(correctionSourceLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
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
          {school && (
            <span className="pill">
              School:{" "}
              {coordinatorSchoolOptions.find(
                (option) => option.value === school,
              )?.label ?? school}
            </span>
          )}
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
          currentPath={buildReturnPath(role, searchParams)}
          proofreaderType={user.proofreader_type ?? null}
        />
      )}
    </main>
  );
}
