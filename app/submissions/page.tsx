import { Nav } from "@/components/nav";
import { PaginationControls } from "@/components/pagination-controls";
import { requireUser } from "@/lib/auth";
import { getSubmissionFilterOptions } from "@/lib/filter-options";
import { firstParam, getPage, getPageSize, getRange } from "@/lib/pagination";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { labelWorkflowStatus } from "@/lib/workflow";
import { SubmissionsClient } from "./submissions-client";

export const dynamic = "force-dynamic";

type FilterOptions = {
  registrationStatuses: string[];
  workflowStatuses: string[];
  pathways: string[];
  subpathways: string[];
  regions: string[];
  schoolTypes: string[];
};

const emptyOptions: FilterOptions = {
  registrationStatuses: [],
  workflowStatuses: [],
  pathways: [],
  subpathways: [],
  regions: [],
  schoolTypes: [],
};

function ErrorBox({
  title,
  message,
  details,
}: {
  title: string;
  message: string;
  details?: string | null;
}) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 16,
        background: "#fff1f1",
        border: "1px solid #d88",
        whiteSpace: "pre-wrap",
      }}
    >
      <strong>{title}</strong>
      {"\n"}
      {message}
      {details ? (
        <>
          {"\n\n"}
          <strong>Details:</strong>
          {"\n"}
          {details}
        </>
      ) : null}
    </div>
  );
}

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser([
    "admin",
    "management",
    "proofreader",
    "reviewer",
    "adek_hq",
  ]);

  const params = (await searchParams) ?? {};

  const registrationStatus = firstParam(params.registration_status);
  const workflowStatus = firstParam(params.workflow_status);
  const pathway = firstParam(params.pathway);
  const subpathway = firstParam(params.subpathway);
  const region = firstParam(params.region);
  const schoolType = firstParam(params.school_type);
  const search = firstParam(params.search);
  const dateFrom = firstParam(params.date_from);
  const dateTo = firstParam(params.date_to);

  const page = getPage(params.page);
  const pageSize = getPageSize(params.page_size);
  const { from, to } = getRange(page, pageSize);

  let options: FilterOptions = emptyOptions;
  let optionsError: string | null = null;

  try {
    options = await getSubmissionFilterOptions();
  } catch (error: any) {
    optionsError = error?.message ?? "Failed to load filter options.";
  }

  let query = supabaseAdmin
    .from("submissions")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (registrationStatus) query = query.eq("registration_status", registrationStatus);
  if (workflowStatus) query = query.eq("workflow_status", workflowStatus);
  if (pathway) query = query.eq("art_pathway_name_en", pathway);
  if (subpathway) query = query.eq("art_sub_pathway_name_en", subpathway);
  if (region) query = query.eq("school_region", region);
  if (schoolType) query = query.eq("institution_type", schoolType);
  if (dateFrom) query = query.gte("submission_date_value", dateFrom);
  if (dateTo) query = query.lte("submission_date_value", dateTo);

  if (search) {
    const safeSearch = search.replace(/[%_]/g, "");

    query = query.or(
      [
        `reference_id.ilike.%${safeSearch}%`,
        `institution_name.ilike.%${safeSearch}%`,
        `group_name.ilike.%${safeSearch}%`,
        `artwork_title_en.ilike.%${safeSearch}%`,
        `artwork_title_ar.ilike.%${safeSearch}%`,
        `updated_artwork_file_name.ilike.%${safeSearch}%`,
      ].join(",")
    );
  }

  const { data, count, error } = await query;

  const currentQuery = new URLSearchParams();

  for (const [key, value] of Object.entries({
    registration_status: registrationStatus,
    workflow_status: workflowStatus,
    pathway,
    subpathway,
    region,
    school_type: schoolType,
    search,
    date_from: dateFrom,
    date_to: dateTo,
    page_size: String(pageSize),
  })) {
    if (value) currentQuery.set(key, value);
  }

  if (error) {
    return (
      <main className="container">
        <Nav role={user.role} />

        <div className="card">
          <h1>All Submissions</h1>
          <p className="muted">The submissions query failed.</p>

          <ErrorBox
            title="Database error:"
            message={error.message}
            details={error.details}
          />
        </div>
      </main>
    );
  }

  const submissions = data ?? [];
  const totalResults = count ?? 0;
  const redirectTo = `/submissions?${currentQuery.toString()}&page=${page}`;

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="table-title-row">
        <div>
          <h1>All Submissions</h1>
          <p className="muted">
            View submissions in rows. Click View to open the full submission
            details. Updated artwork files are available here when uploaded by a
            Coordinator.
          </p>
        </div>
      </div>

      {optionsError && (
        <ErrorBox
          title="Filter warning:"
          message={optionsError}
          details="The submissions list can still load, but filter dropdowns may be incomplete until the filter options view is fixed."
        />
      )}

      <div className="card workspace-toolbar">
        <h2>Filters</h2>

        <form className="grid grid-4" action="" method="get">
          <input type="hidden" name="page" value="1" />

          <label>
            <span className="small">Date from</span>
            <input className="input" type="date" name="date_from" defaultValue={dateFrom} />
          </label>

          <label>
            <span className="small">Date to</span>
            <input className="input" type="date" name="date_to" defaultValue={dateTo} />
          </label>

          <label>
            <span className="small">Registration status</span>
            <select className="input" name="registration_status" defaultValue={registrationStatus}>
              <option value="">All</option>
              {options.registrationStatuses.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">Workflow status</span>
            <select className="input" name="workflow_status" defaultValue={workflowStatus}>
              <option value="">All</option>
              {options.workflowStatuses.map((x) => (
                <option key={x} value={x}>{labelWorkflowStatus(x)}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">Pathway</span>
            <select className="input" name="pathway" defaultValue={pathway}>
              <option value="">All</option>
              {options.pathways.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">Subpathway</span>
            <select className="input" name="subpathway" defaultValue={subpathway}>
              <option value="">All</option>
              {options.subpathways.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">Region</span>
            <select className="input" name="region" defaultValue={region}>
              <option value="">All</option>
              {options.regions.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">School type</span>
            <select className="input" name="school_type" defaultValue={schoolType}>
              <option value="">All</option>
              {options.schoolTypes.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="small">Search</span>
            <input
              className="input"
              name="search"
              placeholder="Artwork name, reference ID, school, group, updated file"
              defaultValue={search}
            />
          </label>

          <label>
            <span className="small">Page size</span>
            <select className="input compact-input" name="page_size" defaultValue={String(pageSize)}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>

          <div className="actions">
            <button className="btn" type="submit">Apply Filters</button>
            <a className="btn secondary" href="/submissions">Clear</a>
          </div>
        </form>
      </div>

      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalResults={totalResults}
        basePath="/submissions"
        query={currentQuery}
      />

      <SubmissionsClient submissions={submissions} redirectTo={redirectTo} />

      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalResults={totalResults}
        basePath="/submissions"
        query={currentQuery}
      />
    </main>
  );
}