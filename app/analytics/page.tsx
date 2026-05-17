import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DownloadPdfButton } from "./DownloadPdfButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ChartRow = {
  name: string;
  value: number;
  percentage?: number;
};

type UserProgressRow = {
  full_name: string;
  role: string;
  assigned: number;
  completed: number;
  remaining: number;
  completion_rate: number;
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

async function getLiveStudentCycles(): Promise<ChartRow[]> {
  const { data, error } = await supabaseAdmin
    .from("students")
    .select("student_key,grade");

  if (error) {
    console.error("Cycle analytics failed:", error.message);
    return [];
  }

  const seen = new Set<string>();
  const counts: Record<string, number> = {
    "Cycle 1": 0,
    "Cycle 2": 0,
    "Cycle 3": 0,
    Unspecified: 0,
  };

  for (const row of data ?? []) {
    if (!row.student_key || seen.has(row.student_key)) continue;
    seen.add(row.student_key);

    const cycle = cycleForGrade(row.grade);
    counts[cycle] = (counts[cycle] ?? 0) + 1;
  }

  return ["Cycle 1", "Cycle 2", "Cycle 3", "Unspecified"]
    .map((name) => ({ name, value: counts[name] ?? 0 }))
    .filter((row) => row.value > 0 || row.name !== "Unspecified");
}

function BarChart({
  title,
  rows,
  emptyText = "No data available.",
}: {
  title: string;
  rows: ChartRow[];
  emptyText?: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);

  return (
    <div className="card">
      <h2>{title}</h2>

      {rows.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="chart-list">
          {rows.map((row) => {
            const width = max
              ? Math.max(4, Math.round((row.value / max) * 100))
              : 0;

            return (
              <div className="chart-row" key={row.name}>
                <div className="chart-label">{row.name}</div>
                <div className="chart-track">
                  <div className="chart-fill" style={{ width: `${width}%` }} />
                </div>
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
          <div
            style={{
              height: 28,
              borderRadius: 999,
              overflow: "hidden",
              display: "flex",
              background: "rgba(178, 199, 192, 0.35)",
              marginBottom: 16,
            }}
          >
            <div
              title={`UAE: ${uae}`}
              style={{
                width: `${uaePct}%`,
                background: "#1C3E3B",
              }}
            />
            <div
              title={`Non-UAE: ${nonUae}`}
              style={{
                width: `${nonUaePct}%`,
                background: "#B2C7C0",
              }}
            />
          </div>

          <div className="pie-legend">
            <div className="pie-item">
              <span>
                <span className="pie-dot" />
                UAE
              </span>
              <strong>
                {uae} ({uaePct}%)
              </strong>
            </div>

            <div className="pie-item">
              <span>
                <span className="pie-dot secondary" />
                Non-UAE
              </span>
              <strong>
                {nonUae} ({nonUaePct}%)
              </strong>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

async function getFilterOptions() {
  const { data } = await supabaseAdmin
    .from("analytics_filter_options")
    .select("filter_type,value")
    .order("filter_type")
    .order("value");

  const grouped: Record<string, string[]> = {};

  for (const row of data ?? []) {
    if (!grouped[row.filter_type]) grouped[row.filter_type] = [];
    grouped[row.filter_type].push(row.value);
  }

  return grouped;
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

    supabaseAdmin.from("assignments").select("assigned_to,status"),
  ]);

  if (usersError) {
    console.error("Live user progress users query failed:", usersError.message);
    return [];
  }

  if (assignmentsError) {
    console.error(
      "Live user progress assignments query failed:",
      assignmentsError.message
    );
    return [];
  }

  const progressMap = new Map<
    string,
    {
      assigned: number;
      completed: number;
    }
  >();

  for (const user of users ?? []) {
    progressMap.set(user.id, {
      assigned: 0,
      completed: 0,
    });
  }

  for (const assignment of assignments ?? []) {
    if (!assignment.assigned_to) continue;

    const current = progressMap.get(assignment.assigned_to);
    if (!current) continue;

    current.assigned += 1;

    if (assignment.status === "completed") {
      current.completed += 1;
    }
  }

  return (users ?? [])
    .map((user: any) => {
      const progress = progressMap.get(user.id) ?? {
        assigned: 0,
        completed: 0,
      };

      const remaining = Math.max(0, progress.assigned - progress.completed);
      const completionRate = pct(progress.completed, progress.assigned);

      return {
        full_name: user.full_name ?? user.id,
        role: user.role,
        assigned: progress.assigned,
        completed: progress.completed,
        remaining,
        completion_rate: completionRate,
      };
    })
    .sort((a, b) => {
      if (b.assigned !== a.assigned) return b.assigned - a.assigned;
      if (b.completed !== a.completed) return b.completed - a.completed;
      return a.full_name.localeCompare(b.full_name);
    });
}

async function getMaterializedAnalytics() {
  const [
    dimensions,
    nationalities,
    schools,
    genders,
    grades,
    userProgress,
    cycleRows,
  ] = await Promise.all([
    supabaseAdmin
      .from("analytics_submission_dimension_mv")
      .select("dimension,name,value"),

    supabaseAdmin
      .from("analytics_student_nationalities_mv")
      .select("nationality,unique_students"),

    supabaseAdmin
      .from("analytics_unique_schools_mv")
      .select("dimension,name,value"),

    supabaseAdmin
      .from("analytics_student_genders_mv")
      .select("gender,unique_students")
      .order("unique_students", { ascending: false }),

    supabaseAdmin
      .from("analytics_student_grades_mv")
      .select("grade,unique_students")
      .order("unique_students", { ascending: false }),

    getLiveUserProgress(),
    getLiveStudentCycles(),
  ]);

  const dimensionRows = dimensions.data ?? [];
  const schoolRows = schools.data ?? [];

  const byDimension = (dimension: string): ChartRow[] =>
    dimensionRows
      .filter((row: any) => row.dimension === dimension)
      .map((row: any) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      }))
      .sort((a, b) => b.value - a.value);

  const bySchoolDimension = (dimension: string): ChartRow[] =>
    schoolRows
      .filter((row: any) => row.dimension === dimension)
      .map((row: any) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      }))
      .sort((a, b) => b.value - a.value);

  const nationalityTable: ChartRow[] = (nationalities.data ?? [])
    .map((row: any) => ({
      name: row.nationality,
      value: Number(row.unique_students ?? 0),
    }))
    .sort((a, b) => b.value - a.value);

  const nationalityTotal = nationalityTable.reduce(
    (sum, row) => sum + row.value,
    0
  );

  const nationalityTableWithPct = nationalityTable.map((row) => ({
    ...row,
    percentage: pct(row.value, nationalityTotal),
  }));

  const uaeCount = nationalityTable
    .filter((row) => isUaeNationality(row.name))
    .reduce((sum, row) => sum + row.value, 0);

  const nonUaeCount = Math.max(0, nationalityTotal - uaeCount);

  const genderRows: ChartRow[] = (genders.data ?? []).map((row: any) => ({
    name: row.gender,
    value: Number(row.unique_students ?? 0),
  }));

  const gradeRows: ChartRow[] = (grades.data ?? []).map((row: any) => ({
    name: row.grade,
    value: Number(row.unique_students ?? 0),
  }));

  return {
    byPathway: byDimension("pathway"),
    bySubpathway: byDimension("subpathway"),
    bySchoolType: byDimension("school_type"),
    byRegion: byDimension("region"),
    uniqueSchoolsByRegion: bySchoolDimension("region"),
    uniqueSchoolsByType: bySchoolDimension("school_type"),
    nationalityTotal,
    uaeCount,
    nonUaeCount,
    nationalityTable: nationalityTableWithPct,
    genderRows,
    gradeRows,
    cycleRows,
    userProgress,
  };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser([
    "admin",
    "management",
    "coordinator",
    "evaluator",
    "proofreader",
    "reviewer",
    "adek_hq",
  ]);

  const params = (await searchParams) ?? {};
  const exportPdfMode = firstParam(params.export_pdf) === "1";

  const filters = {
    pathway: firstParam(params.pathway),
    subpathway: firstParam(params.subpathway),
    schoolType: firstParam(params.school_type),
    region: firstParam(params.region),
    registrationStatus: firstParam(params.registration_status),
    workflowStatus: firstParam(params.workflow_status),
  };

  const [options, analytics] = await Promise.all([
    getFilterOptions(),
    getMaterializedAnalytics(),
  ]);

  return (
    <main className="container" data-analytics-export-area>
      {!exportPdfMode && <Nav role={user.role} />}

      <div className="table-title-row">
        <div>
          <h1>Analytics Dashboard</h1>
          <p className="muted">
            Charts use optimized analytics summaries. User progress is live from
            the assignments table.
          </p>
        </div>

        {!exportPdfMode && <DownloadPdfButton />}
      </div>

      <div className="card analytics-section">
        <h2>Analytics Filters</h2>

        <form className="grid grid-3 no-print" method="get">
          <label>
            <span className="small">Pathway</span>
            <select name="pathway" defaultValue={filters.pathway}>
              <option value="">All pathways</option>
              {(options.pathway ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">Subpathway</span>
            <select name="subpathway" defaultValue={filters.subpathway}>
              <option value="">All subpathways</option>
              {(options.subpathway ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">School Type</span>
            <select name="school_type" defaultValue={filters.schoolType}>
              <option value="">All school types</option>
              {(options.school_type ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">Region</span>
            <select name="region" defaultValue={filters.region}>
              <option value="">All regions</option>
              {(options.region ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">Registration Status</span>
            <select
              name="registration_status"
              defaultValue={filters.registrationStatus}
            >
              <option value="">All registration statuses</option>
              {(options.registration_status ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">Workflow Status</span>
            <select
              name="workflow_status"
              defaultValue={filters.workflowStatus}
            >
              <option value="">All workflow statuses</option>
              {(options.workflow_status ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <div className="actions">
            <button className="btn" type="submit">
              Apply Filters
            </button>
            <a className="btn secondary" href="/analytics">
              Clear
            </a>
          </div>
        </form>

        {exportPdfMode ? (
          <p className="muted small" style={{ marginTop: 12 }}>
            Exported dashboard snapshot.
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: 12 }}>
            User Progress updates live. Other analytics charts use cached
            summaries for speed.
          </p>
        )}
      </div>

      <div className="grid grid-4 analytics-section">
        <div className="card">
          <h2>Unique Students</h2>
          <p className="stat-number">{analytics.nationalityTotal}</p>
        </div>

        <div className="card">
          <h2>UAE Students</h2>
          <p className="stat-number">{analytics.uaeCount}</p>
        </div>

        <div className="card">
          <h2>Non-UAE Students</h2>
          <p className="stat-number">{analytics.nonUaeCount}</p>
        </div>

        <div className="card">
          <h2>Users Tracked</h2>
          <p className="stat-number">{analytics.userProgress.length}</p>
        </div>
      </div>

      <div className="grid grid-2 analytics-section">
        <NationalityPie uae={analytics.uaeCount} nonUae={analytics.nonUaeCount} />
        <BarChart title="Unique Students by Gender" rows={analytics.genderRows} />
      </div>

      <div className="grid grid-2 analytics-section">
        <BarChart title="Unique Students by Grade" rows={analytics.gradeRows} />
        <BarChart title="Unique Students by Cycle" rows={analytics.cycleRows} />
      </div>

      <div className="grid grid-2 analytics-section">
        <BarChart title="Submissions by Region" rows={analytics.byRegion} />
      </div>

      <div className="grid grid-2 analytics-section">
        <BarChart title="Submissions by Pathway" rows={analytics.byPathway} />
        <BarChart
          title="Submissions by Subpathway"
          rows={analytics.bySubpathway}
        />
      </div>

      <div className="grid grid-2 analytics-section">
        <BarChart title="Submissions by School Type" rows={analytics.bySchoolType} />
        <BarChart
          title="Unique Schools by Region"
          rows={analytics.uniqueSchoolsByRegion}
        />
      </div>

      <div className="grid grid-2 analytics-section">
        <BarChart
          title="Unique Schools by School Type"
          rows={analytics.uniqueSchoolsByType}
        />
      </div>

      <div className="card analytics-section">
        <h2>Student Nationalities Table</h2>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nationality</th>
                <th>Unique Students</th>
                <th>Percentage</th>
              </tr>
            </thead>

            <tbody>
              {analytics.nationalityTable.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.value}</td>
                  <td>{row.percentage?.toFixed(2)}%</td>
                </tr>
              ))}

              {analytics.nationalityTable.length === 0 && (
                <tr>
                  <td colSpan={3}>No nationality data available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card analytics-section">
        <div className="table-title-row">
          <div>
            <h2>User Progress</h2>
            <p className="muted">
              Live numbers from assignments. No SQL refresh needed.
            </p>
          </div>
          <span className="pill">Live</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Assigned</th>
                <th>Completed</th>
                <th>Remaining</th>
                <th>Completion Rate</th>
              </tr>
            </thead>

            <tbody>
              {analytics.userProgress.map((row) => (
                <tr key={`${row.full_name}-${row.role}`}>
                  <td>{row.full_name}</td>
                  <td>{row.role}</td>
                  <td>{row.assigned}</td>
                  <td>{row.completed}</td>
                  <td>{row.remaining}</td>
                  <td>{Number(row.completion_rate).toFixed(2)}%</td>
                </tr>
              ))}

              {analytics.userProgress.length === 0 && (
                <tr>
                  <td colSpan={6}>No user progress data available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}