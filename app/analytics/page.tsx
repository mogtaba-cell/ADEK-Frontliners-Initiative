import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DownloadPdfButton } from "./DownloadPdfButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ChartRow = { name: string; value: number; percentage?: number };
type UserProgressRow = {
  full_name: string;
  role: string;
  assigned: number;
  completed: number;
  remaining: number;
  completion_rate: number;
};

type AnalyticsFilters = {
  pathway: string;
  subpathway: string;
  schoolType: string;
  region: string;
  registrationStatus: string;
  workflowStatus: string;
  outcome: string;
};

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function pct(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 10000) / 100;
}

function isUaeNationality(name: string) {
  const normalized = name.trim().toLowerCase();
  return [
    "uae",
    "u.a.e",
    "u.a.e.",
    "united arab emirates",
    "emirati",
    "emirates",
    "الإمارات",
    "الامارات",
    "الإمارات العربية المتحدة",
    "الامارات العربية المتحدة",
    "اماراتي",
    "إماراتي",
  ].some((term) => normalized.includes(term));
}

function cycleForGrade(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "Unspecified";
  if (/kg|kindergarten|fs\s*1|fs\s*2/.test(raw)) return "Cycle 1";
  const match = raw.match(/grade\s*([0-9]{1,2})|g\s*([0-9]{1,2})/i);
  const grade = match ? Number(match[1] ?? match[2]) : Number.NaN;
  if (!Number.isFinite(grade)) return "Unspecified";
  if (grade <= 5) return "Cycle 1";
  if (grade <= 8) return "Cycle 2";
  return "Cycle 3";
}

function normalizeGrade(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unspecified";
  const match = raw.match(/grade\s*([0-9]{1,2})|g\s*([0-9]{1,2})/i);
  if (match) return `Grade ${Number(match[1] ?? match[2])}`;
  return raw;
}

function addCount(map: Map<string, number>, key: unknown) {
  const label = String(key ?? "").trim() || "Unspecified";
  map.set(label, (map.get(label) ?? 0) + 1);
}

function mapToRows(map: Map<string, number>): ChartRow[] {
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function BarChart({ title, rows, emptyText = "No data available." }: { title: string; rows: ChartRow[]; emptyText?: string }) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  return (
    <div className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="chart-list">
          {rows.map((row) => {
            const width = max ? Math.max(4, Math.round((row.value / max) * 100)) : 0;
            return (
              <div className="chart-row" key={row.name}>
                <div className="chart-label">{row.name}</div>
                <div className="chart-track"><div className="chart-fill" style={{ width: `${width}%` }} /></div>
                <div className="chart-value">{row.value}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NationalityPie({ uae, nonUae }: { uae: number; nonUae: number }) {
  const total = uae + nonUae;
  const uaePct = pct(uae, total);
  const nonUaePct = pct(nonUae, total);
  return (
    <div className="card">
      <h2>Unique Students: UAE / Non-UAE</h2>
      {total === 0 ? (
        <p className="muted">No nationality data available.</p>
      ) : (
        <>
          <div style={{ height: 28, borderRadius: 999, overflow: "hidden", display: "flex", background: "rgba(178, 199, 192, 0.35)", marginBottom: 16 }}>
            <div title={`UAE: ${uae}`} style={{ width: `${uaePct}%`, background: "#1C3E3B" }} />
            <div title={`Non-UAE: ${nonUae}`} style={{ width: `${nonUaePct}%`, background: "#B2C7C0" }} />
          </div>
          <div className="pie-legend">
            <div className="pie-item"><span><span className="pie-dot" />UAE</span><strong>{uae} ({uaePct}%)</strong></div>
            <div className="pie-item"><span><span className="pie-dot secondary" />Non-UAE</span><strong>{nonUae} ({nonUaePct}%)</strong></div>
          </div>
        </>
      )}
    </div>
  );
}

async function getFilterOptions() {
  const { data } = await supabaseAdmin
    .from("submissions")
    .select("art_pathway_name_en,art_sub_pathway_name_en,institution_type,school_region,registration_status,workflow_status")
    .limit(10000);

  const grouped: Record<string, Set<string>> = {
    pathway: new Set(),
    subpathway: new Set(),
    school_type: new Set(),
    region: new Set(),
    registration_status: new Set(),
    workflow_status: new Set(),
  };

  for (const row of data ?? []) {
    if (row.art_pathway_name_en) grouped.pathway.add(row.art_pathway_name_en);
    if (row.art_sub_pathway_name_en) grouped.subpathway.add(row.art_sub_pathway_name_en);
    if (row.institution_type) grouped.school_type.add(row.institution_type);
    if (row.school_region) grouped.region.add(row.school_region);
    if (row.registration_status) grouped.registration_status.add(row.registration_status);
    if (row.workflow_status) grouped.workflow_status.add(row.workflow_status);
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([key, set]) => [key, Array.from(set).sort()])
  ) as Record<string, string[]>;
}

async function getLiveUserProgress(): Promise<UserProgressRow[]> {
  const [
    { data: users, error: usersError },
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id,full_name,role,is_active")
      .not("role", "in", "(admin,adek_hq)")
      .eq("is_active", true)
      .order("role", { ascending: true })
      .order("full_name", { ascending: true }),
    supabaseAdmin
      .from("assignments")
      .select("assigned_to,status,completed_at")
      .in("status", ["assigned", "in_progress", "returned_for_correction", "sent_for_review", "completed"]),
  ]);

  if (usersError) {
    console.error("Live user progress users query failed:", usersError.message);
    return [];
  }
  if (assignmentsError) {
    console.error("Live user progress assignments query failed:", assignmentsError.message);
    return [];
  }

  const progressMap = new Map<string, { assigned: number; completed: number; remaining: number }>();
  for (const user of users ?? []) progressMap.set(user.id, { assigned: 0, completed: 0, remaining: 0 });

  for (const assignment of assignments ?? []) {
    if (!assignment.assigned_to) continue;
    const current = progressMap.get(assignment.assigned_to);
    if (!current) continue;
    current.assigned += 1;
    if (assignment.status === "completed" && assignment.completed_at) current.completed += 1;
    if (["assigned", "in_progress", "returned_for_correction", "sent_for_review"].includes(assignment.status)) current.remaining += 1;
  }

  return (users ?? [])
    .map((user: any) => {
      const progress = progressMap.get(user.id) ?? { assigned: 0, completed: 0, remaining: 0 };
      return {
        full_name: user.full_name ?? user.id,
        role: user.role,
        assigned: progress.assigned,
        completed: progress.completed,
        remaining: progress.remaining,
        completion_rate: pct(progress.completed, progress.assigned),
      };
    })
    .sort((a, b) => b.assigned - a.assigned || b.completed - a.completed || a.full_name.localeCompare(b.full_name));
}

function submissionMatchesOutcome(row: any, outcome: string) {
  if (!outcome) return true;
  if (outcome === "approved") return row.evaluation_decision === "approved" && row.workflow_status !== "disqualified";
  if (outcome === "disqualified") return row.workflow_status === "disqualified" || row.evaluation_decision === "disqualified" || row.management_decision === "disqualified";
  if (outcome === "needs_management_review") return row.workflow_status === "needs_management_review" || row.evaluation_decision === "needs_review";
  if (outcome === "final_ready") return row.workflow_status === "completed" || row.reviewer_decision === "completed";
  return true;
}

function submissionMatchesFilters(row: any, filters: AnalyticsFilters) {
  if (filters.pathway && row.art_pathway_name_en !== filters.pathway) return false;
  if (filters.subpathway && row.art_sub_pathway_name_en !== filters.subpathway) return false;
  if (filters.schoolType && row.institution_type !== filters.schoolType) return false;
  if (filters.region && row.school_region !== filters.region) return false;
  if (filters.registrationStatus && row.registration_status !== filters.registrationStatus) return false;
  if (filters.workflowStatus && row.workflow_status !== filters.workflowStatus) return false;
  if (!submissionMatchesOutcome(row, filters.outcome)) return false;
  return true;
}

async function getFilteredAnalytics(filters: AnalyticsFilters) {
  const { data: allSubmissions, error } = await supabaseAdmin
    .from("submissions")
    .select("id,art_pathway_name_en,art_sub_pathway_name_en,institution_type,school_region,institution_ref_number,institution_name,registration_status,workflow_status,evaluation_decision,management_decision,reviewer_decision")
    .limit(20000);

  if (error) {
    console.error("Analytics submissions query failed:", error.message);
  }

  const submissions = (allSubmissions ?? []).filter((row) => submissionMatchesFilters(row, filters));
  const submissionIds = submissions.map((row) => row.id);
  const byPathway = new Map<string, number>();
  const bySubpathway = new Map<string, number>();
  const bySchoolType = new Map<string, number>();
  const byRegion = new Map<string, number>();
  const uniqueSchoolsByRegion = new Map<string, Set<string>>();
  const uniqueSchoolsByType = new Map<string, Set<string>>();

  for (const row of submissions) {
    addCount(byPathway, row.art_pathway_name_en);
    addCount(bySubpathway, row.art_sub_pathway_name_en);
    addCount(bySchoolType, row.institution_type);
    addCount(byRegion, row.school_region);
    const schoolKey = String(row.institution_ref_number ?? row.institution_name ?? "Unknown School").trim() || "Unknown School";
    const region = String(row.school_region ?? "Unspecified").trim() || "Unspecified";
    const type = String(row.institution_type ?? "Unspecified").trim() || "Unspecified";
    if (!uniqueSchoolsByRegion.has(region)) uniqueSchoolsByRegion.set(region, new Set());
    if (!uniqueSchoolsByType.has(type)) uniqueSchoolsByType.set(type, new Set());
    uniqueSchoolsByRegion.get(region)?.add(schoolKey);
    uniqueSchoolsByType.get(type)?.add(schoolKey);
  }

  const students: any[] = [];
  for (let i = 0; i < submissionIds.length; i += 500) {
    const chunk = submissionIds.slice(i, i + 500);
    if (!chunk.length) continue;
    const { data, error: studentError } = await supabaseAdmin
      .from("students")
      .select("student_key,gender,nationality,grade")
      .in("submission_id", chunk);
    if (studentError) console.error("Analytics students query failed:", studentError.message);
    students.push(...(data ?? []));
  }

  const seenStudents = new Set<string>();
  const nationalityCounts = new Map<string, number>();
  const genderCounts = new Map<string, number>();
  const gradeCounts = new Map<string, number>();
  const cycleCounts = new Map<string, number>();

  for (const student of students) {
    if (!student.student_key || seenStudents.has(student.student_key)) continue;
    seenStudents.add(student.student_key);
    addCount(nationalityCounts, student.nationality);
    addCount(genderCounts, student.gender);
    addCount(gradeCounts, normalizeGrade(student.grade));
    addCount(cycleCounts, cycleForGrade(student.grade));
  }

  const nationalityTable = mapToRows(nationalityCounts);
  const nationalityTotal = nationalityTable.reduce((sum, row) => sum + row.value, 0);
  const nationalityTableWithPct = nationalityTable.map((row) => ({ ...row, percentage: pct(row.value, nationalityTotal) }));
  const uaeCount = nationalityTable.filter((row) => isUaeNationality(row.name)).reduce((sum, row) => sum + row.value, 0);
  const nonUaeCount = Math.max(0, nationalityTotal - uaeCount);

  const schoolSetToRows = (map: Map<string, Set<string>>) =>
    Array.from(map.entries()).map(([name, set]) => ({ name, value: set.size })).sort((a, b) => b.value - a.value);

  return {
    byPathway: mapToRows(byPathway),
    bySubpathway: mapToRows(bySubpathway),
    bySchoolType: mapToRows(bySchoolType),
    byRegion: mapToRows(byRegion),
    uniqueSchoolsByRegion: schoolSetToRows(uniqueSchoolsByRegion),
    uniqueSchoolsByType: schoolSetToRows(uniqueSchoolsByType),
    nationalityTotal,
    uaeCount,
    nonUaeCount,
    nationalityTable: nationalityTableWithPct,
    genderRows: mapToRows(genderCounts),
    gradeRows: mapToRows(gradeCounts),
    cycleRows: mapToRows(cycleCounts),
    userProgress: await getLiveUserProgress(),
  };
}

export default async function AnalyticsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(["admin", "management", "coordinator", "evaluator", "proofreader", "reviewer", "adek_hq"]);
  const params = (await searchParams) ?? {};
  const exportPdfMode = firstParam(params.export_pdf) === "1";
  const filters: AnalyticsFilters = {
    pathway: firstParam(params.pathway),
    subpathway: firstParam(params.subpathway),
    schoolType: firstParam(params.school_type),
    region: firstParam(params.region),
    registrationStatus: firstParam(params.registration_status),
    workflowStatus: firstParam(params.workflow_status),
    outcome: firstParam(params.outcome),
  };

  const [options, analytics] = await Promise.all([getFilterOptions(), getFilteredAnalytics(filters)]);

  return (
    <main className="container" data-analytics-export-area>
      {!exportPdfMode && <Nav role={user.role} />}
      <div className="table-title-row">
        <div>
          <h1>Analytics Dashboard</h1>
          <p className="muted">Charts and user progress use live filtered data.</p>
        </div>
        {!exportPdfMode && <DownloadPdfButton />}
      </div>

      <div className="card analytics-section">
        <h2>Analytics Filters</h2>
        <form className="grid grid-3 no-print" method="get">
          <label><span className="small">Pathway</span><select name="pathway" defaultValue={filters.pathway}><option value="">All pathways</option>{(options.pathway ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span className="small">Subpathway</span><select name="subpathway" defaultValue={filters.subpathway}><option value="">All subpathways</option>{(options.subpathway ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span className="small">School Type</span><select name="school_type" defaultValue={filters.schoolType}><option value="">All school types</option>{(options.school_type ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span className="small">Region</span><select name="region" defaultValue={filters.region}><option value="">All regions</option>{(options.region ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span className="small">Registration Status</span><select name="registration_status" defaultValue={filters.registrationStatus}><option value="">All registration statuses</option>{(options.registration_status ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span className="small">Workflow Status</span><select name="workflow_status" defaultValue={filters.workflowStatus}><option value="">All workflow statuses</option>{(options.workflow_status ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span className="small">Artwork Outcome</span><select name="outcome" defaultValue={filters.outcome}><option value="">All artworks</option><option value="approved">Approved artworks only</option><option value="disqualified">Disqualified artworks only</option><option value="needs_management_review">Needs management review</option><option value="final_ready">Final ready / completed</option></select></label>
          <div className="actions"><button className="btn" type="submit">Apply Filters</button><a className="btn secondary" href="/analytics">Clear</a></div>
        </form>
      </div>

      <div className="grid grid-4 analytics-section">
        <div className="card"><h2>Unique Students</h2><p className="stat-number">{analytics.nationalityTotal}</p></div>
        <div className="card"><h2>UAE Students</h2><p className="stat-number">{analytics.uaeCount}</p></div>
        <div className="card"><h2>Non-UAE Students</h2><p className="stat-number">{analytics.nonUaeCount}</p></div>
        <div className="card"><h2>Users Tracked</h2><p className="stat-number">{analytics.userProgress.length}</p></div>
      </div>

      <div className="grid grid-2 analytics-section"><NationalityPie uae={analytics.uaeCount} nonUae={analytics.nonUaeCount} /><BarChart title="Unique Students by Gender" rows={analytics.genderRows} /></div>
      <div className="grid grid-2 analytics-section"><BarChart title="Unique Students by Grade" rows={analytics.gradeRows} /><BarChart title="Unique Students by Cycle" rows={analytics.cycleRows} /></div>
      <div className="grid grid-2 analytics-section"><BarChart title="Submissions by Region" rows={analytics.byRegion} /></div>
      <div className="grid grid-2 analytics-section"><BarChart title="Submissions by Pathway" rows={analytics.byPathway} /><BarChart title="Submissions by Subpathway" rows={analytics.bySubpathway} /></div>
      <div className="grid grid-2 analytics-section"><BarChart title="Submissions by School Type" rows={analytics.bySchoolType} /><BarChart title="Unique Schools by Region" rows={analytics.uniqueSchoolsByRegion} /></div>
      <div className="grid grid-2 analytics-section"><BarChart title="Unique Schools by School Type" rows={analytics.uniqueSchoolsByType} /></div>

      <div className="card analytics-section">
        <h2>Student Nationalities Table</h2>
        <div className="table-wrap"><table><thead><tr><th>Nationality</th><th>Unique Students</th><th>Percentage</th></tr></thead><tbody>{analytics.nationalityTable.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.value}</td><td>{row.percentage?.toFixed(2)}%</td></tr>)}{analytics.nationalityTable.length === 0 && <tr><td colSpan={3}>No nationality data available.</td></tr>}</tbody></table></div>
      </div>

      <div className="card analytics-section">
        <div className="table-title-row"><div><h2>User Progress</h2><p className="muted">Assigned is total assignment history. It does not decrease when tasks are completed.</p></div><span className="pill">Live</span></div>
        <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Assigned</th><th>Completed</th><th>Remaining</th><th>Completion Rate</th></tr></thead><tbody>{analytics.userProgress.map((row) => <tr key={`${row.full_name}-${row.role}`}><td>{row.full_name}</td><td>{row.role}</td><td>{row.assigned}</td><td>{row.completed}</td><td>{row.remaining}</td><td>{Number(row.completion_rate).toFixed(2)}%</td></tr>)}{analytics.userProgress.length === 0 && <tr><td colSpan={6}>No user progress data available.</td></tr>}</tbody></table></div>
      </div>
    </main>
  );
}
