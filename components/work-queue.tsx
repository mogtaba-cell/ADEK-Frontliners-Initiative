import Link from "next/link";
import { Nav } from "@/components/nav";
import { PaginationControls } from "@/components/pagination-controls";
import { requireUser } from "@/lib/auth";
import { getSubmissionFilterOptions } from "@/lib/filter-options";
import { firstParam, getPage, getPageSize, getRange } from "@/lib/pagination";
import { getFilteredSubmissionIds } from "@/lib/submission-query";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Role, WorkflowPhase } from "@/lib/types";
import { labelWorkflowStatus, phaseLabels } from "@/lib/workflow";

type QueueProps = {
  role: Role;
  phase: WorkflowPhase;
  title: string;
  startLabel: string;
  searchParams?: Record<string, string | string[] | undefined>;
  filterMode?: "standard" | "correction";
};

type AssignmentRow = {
  id: string;
  phase: string;
  status: string;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  submissions?: any;
};

const statusByView: Record<string, string[]> = {
  completed: ["completed"],
  all: ["assigned", "in_progress", "completed"],
  not_completed: ["assigned", "in_progress"],
};

export async function WorkQueuePage({ role, phase, title, startLabel, searchParams = {}, filterMode = "standard" }: QueueProps) {
  const user = await requireUser([role]);
  const today = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });

  const view = firstParam(searchParams.view, "not_completed");
  const pathway = firstParam(searchParams.pathway);
  const subpathway = firstParam(searchParams.subpathway);
  const region = firstParam(searchParams.region);
  const schoolType = firstParam(searchParams.school_type);
  const search = firstParam(searchParams.search);
  const page = getPage(searchParams.page);
  const pageSize = getPageSize(searchParams.page_size);
  const { from, to } = getRange(page, pageSize);

  const statuses = statusByView[view] ?? statusByView.not_completed;

  const [options, completedCountRes, remainingCountRes, filteredSubmissionIds] = await Promise.all([
    getSubmissionFilterOptions(),
    supabaseAdmin
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", user.id)
      .eq("phase", phase)
      .eq("status", "completed"),
    supabaseAdmin
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", user.id)
      .eq("phase", phase)
      .in("status", ["assigned", "in_progress"]),
    getFilteredSubmissionIds({ pathway, subpathway, region, schoolType, search }),
  ]);

  let query = supabaseAdmin
    .from("assignments")
    .select("id,phase,status,created_at,started_at,completed_at,submissions(id,reference_id,institution_name,institution_type,school_region,art_pathway_name_en,art_sub_pathway_name_en,workflow_status,art_link,artwork_title_en,artwork_title_ar,submission_date)", { count: "exact" })
    .eq("assigned_to", user.id)
    .eq("phase", phase)
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .range(from, to);

  if (filteredSubmissionIds && filteredSubmissionIds.length === 0) {
    query = query.eq("submission_id", "00000000-0000-0000-0000-000000000000");
  } else if (filteredSubmissionIds) {
    query = query.in("submission_id", filteredSubmissionIds);
  }

  const { data: assignmentData, count } = await query;
  const assignments = (assignmentData ?? []) as AssignmentRow[];

  const completedCount = completedCountRes.count ?? 0;
  const remainingCount = remainingCountRes.count ?? 0;
  const totalResults = count ?? 0;

  return (
    <main className="container">
      <Nav role={user.role} />
      <h1>{title}</h1>

      <div className="grid grid-3">
        <div className="card">
          <strong>Task Date</strong>
          <p className="stat-number">{today}</p>
        </div>
        <div className="card">
          <strong>Remaining</strong>
          <p className="stat-number">{remainingCount}</p>
        </div>
        <div className="card">
          <strong>Completed</strong>
          <p className="stat-number">{completedCount}</p>
        </div>
      </div>

      <div className="card workspace-toolbar">
        <h2>Workspace Filters</h2>
        <p className="muted small">For speed, the page loads only your assigned tasks matching these filters. Default view is Not completed.</p>
        <form className="grid grid-4" action="" method="get">
          <input type="hidden" name="page" value="1" />
          <label>
            <span className="small">1. Select pathway</span>
            <select className="input" name="pathway" defaultValue={pathway}>
              <option value="">All pathways</option>
              {options.pathways.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            <span className="small">Subpathway</span>
            <select className="input" name="subpathway" defaultValue={subpathway}>
              <option value="">All subpathways</option>
              {options.subpathways.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            <span className="small">Region</span>
            <select className="input" name="region" defaultValue={region}>
              <option value="">All regions</option>
              {options.regions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            <span className="small">School type</span>
            <select className="input" name="school_type" defaultValue={schoolType}>
              <option value="">All school types</option>
              {options.schoolTypes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            <span className="small">3. View</span>
            <select className="input" name="view" defaultValue={view}>
              <option value="not_completed">Not completed</option>
              <option value="completed">Completed</option>
              <option value="all">All</option>
            </select>
          </label>
          <label>
            <span className="small">Search</span>
            <input className="input" name="search" defaultValue={search} placeholder="Reference, school, title" />
          </label>
          <div>
            <span className="small">2. Date auto-added</span>
            <input className="input" value={today} readOnly />
          </div>
          <label>
            <span className="small">Page size</span>
            <select className="input" name="page_size" defaultValue={pageSize}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <button className="btn" type="submit">{startLabel}</button>
        </form>
        <div className="filter-summary">
          <span className="pill">Phase: {phaseLabels[phase]}</span>
          <span className="pill">Showing: {view.replace("_", " ")}</span>
          <span className="pill">Results: {totalResults}</span>
          <span className="pill">Page size: {pageSize}</span>
        </div>
      </div>

      <div className="card">
        <div className="table-title-row">
          <h2>Assigned Artworks</h2>
          <PaginationControls page={page} pageSize={pageSize} total={totalResults} searchParams={searchParams} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference ID</th>
                <th>Assignment</th>
                <th>School</th>
                <th>Region</th>
                <th>School Type</th>
                <th>Pathway</th>
                <th>Subpathway</th>
                <th>Workflow</th>
                <th>Artwork</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => {
                const s = a.submissions;
                return (
                  <tr key={a.id}>
                    <td><strong>{s?.reference_id}</strong></td>
                    <td><span className="pill">{a.status}</span></td>
                    <td>{s?.institution_name}</td>
                    <td>{s?.school_region}</td>
                    <td>{s?.institution_type}</td>
                    <td>{s?.art_pathway_name_en}</td>
                    <td>{s?.art_sub_pathway_name_en}</td>
                    <td><span className="pill">{labelWorkflowStatus(s?.workflow_status)}</span></td>
                    <td>{s?.art_link ? <a className="btn secondary" href={s.art_link} target="_blank">Open file</a> : "-"}</td>
                    <td><Link className="btn" href={`/work/${s?.id}?assignment=${a.id}`}>{a.status === "completed" ? "View" : "Open Task"}</Link></td>
                  </tr>
                );
              })}
              {assignments.length === 0 && <tr><td colSpan={10}>No artworks match the selected filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <PaginationControls page={page} pageSize={pageSize} total={totalResults} searchParams={searchParams} />
      </div>
    </main>
  );
}
