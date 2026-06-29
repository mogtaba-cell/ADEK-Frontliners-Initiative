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
  artisticRatings: string[];
};

const emptyOptions: FilterOptions = {
  registrationStatuses: [],
  workflowStatuses: [],
  pathways: [],
  subpathways: [],
  regions: [],
  schoolTypes: [],
  artisticRatings: [],
};


const SUBMISSION_LIST_SELECT = [
  "id",
  "reference_id",
  "registration_id",
  "registration_status",
  "workflow_status",
  "institution_name",
  "institution_type",
  "school_region",
  "group_name",
  "art_pathway_name_en",
  "art_pathway_name_ar",
  "art_sub_pathway_name_en",
  "art_sub_pathway_name_ar",
  "artwork_title_en",
  "artwork_title_ar",
  "description_en",
  "description_ar",
  "influence_idea_source",
  "most_enjoyable_part",
  "focused_elements",
  "participating_students_names",
  "participating_students_esis_numbers",
  "participating_students_genders",
  "participating_students_grades",
  "participating_students_nationalities",
  "submission_date",
  "submission_date_value",
  "artistic_rating",
  "management_artistic_rating",
  "categorized_pathway",
  "categorization_completed_at",
  "artistic_ranking",
  "artistic_quality_creativity_score",
  "initiative_relation_score",
  "age_appropriateness_score",
  "artistic_rubric_total_score",
  "artistic_rubric_comment",
  "artistic_ranking_completed_at",
  "literary_subcategory",
  "literary_subcategory_completed_at",
  "art_link",
  "updated_artwork_file_name",
  "updated_artwork_file_url",
  "raw_data",
  "created_at",
  "updated_at",
].join(",");

const artisticRatingLabels: Record<string, string> = {
  weak: "ضعيف / Weak",
  medium: "متوسط / Medium",
  good: "جيد / Good",
  excellent: "ممتاز / Excellent",
  "ضعيف": "ضعيف / Weak",
  "متوسط": "متوسط / Medium",
  "جيد": "جيد / Good",
  "ممتاز": "ممتاز / Excellent",
};

function labelArtisticRating(value: string) {
  const key = value.trim().toLowerCase();
  return artisticRatingLabels[key] ?? value;
}

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

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function loadSubmissionWorkflowData(submissionIds: string[]) {
  if (!submissionIds.length) {
    return {
      commentsBySubmissionId: new Map<string, any[]>(),
      assignmentsBySubmissionId: new Map<string, any[]>(),
    };
  }

  const comments: any[] = [];
  const assignments: any[] = [];

  for (const chunk of chunkArray(submissionIds, 100)) {
    const { data: commentRows, error: commentsError } = await supabaseAdmin
      .from("comments")
      .select("id,submission_id,author_id,phase,comment_text,created_at")
      .in("submission_id", chunk)
      .order("created_at", { ascending: false });

    if (commentsError) throw commentsError;
    comments.push(...(commentRows ?? []));

    const { data: assignmentRows, error: assignmentsError } = await supabaseAdmin
      .from("assignments")
      .select(
        [
          "id",
          "submission_id",
          "assigned_to",
          "assigned_by",
          "requested_by_user_id",
          "return_to_user_id",
          "correction_source_phase",
          "correction_source_assignment_id",
          "phase",
          "status",
          "decision",
          "proofreader_type",
          "correction_reason",
          "correction_notes",
          "created_at",
          "started_at",
          "completed_at",
          "updated_at",
        ].join(",")
      )
      .in("submission_id", chunk)
      .order("created_at", { ascending: true });

    if (assignmentsError) throw assignmentsError;
    assignments.push(...(assignmentRows ?? []));
  }

  const profileIds = Array.from(
    new Set(
      [
        ...comments.map((comment) => comment.author_id),
        ...assignments.map((assignment) => assignment.assigned_to),
        ...assignments.map((assignment) => assignment.assigned_by),
        ...assignments.map((assignment) => assignment.requested_by_user_id),
        ...assignments.map((assignment) => assignment.return_to_user_id),
      ]
        .filter(Boolean)
        .map(String)
    )
  );

  const profileMap = new Map<string, any>();

  for (const chunk of chunkArray(profileIds, 200)) {
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id,full_name,email,role")
      .in("id", chunk);

    if (profilesError) throw profilesError;

    for (const profile of profiles ?? []) {
      profileMap.set(profile.id, profile);
    }
  }

  const commentsBySubmissionId = new Map<string, any[]>();

  for (const comment of comments) {
    const submissionId = String(comment.submission_id);

    if (!commentsBySubmissionId.has(submissionId)) {
      commentsBySubmissionId.set(submissionId, []);
    }

    commentsBySubmissionId.get(submissionId)?.push({
      ...comment,
      author_profile: comment.author_id ? profileMap.get(comment.author_id) ?? null : null,
    });
  }

  const assignmentsBySubmissionId = new Map<string, any[]>();

  for (const assignment of assignments) {
    const submissionId = String(assignment.submission_id);

    if (!assignmentsBySubmissionId.has(submissionId)) {
      assignmentsBySubmissionId.set(submissionId, []);
    }

    assignmentsBySubmissionId.get(submissionId)?.push({
      ...assignment,
      assigned_profile: assignment.assigned_to
        ? profileMap.get(assignment.assigned_to) ?? null
        : null,
      assigned_by_profile: assignment.assigned_by
        ? profileMap.get(assignment.assigned_by) ?? null
        : null,
      requested_by_profile: assignment.requested_by_user_id
        ? profileMap.get(assignment.requested_by_user_id) ?? null
        : null,
      return_to_profile: assignment.return_to_user_id
        ? profileMap.get(assignment.return_to_user_id) ?? null
        : null,
    });
  }

  return { commentsBySubmissionId, assignmentsBySubmissionId };
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
  const artisticRating = firstParam(params.artistic_rating);
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
    .select(SUBMISSION_LIST_SELECT, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (registrationStatus) query = query.eq("registration_status", registrationStatus);
  if (workflowStatus) query = query.eq("workflow_status", workflowStatus);
  if (pathway) query = query.eq("art_pathway_name_en", pathway);
  if (subpathway) query = query.eq("art_sub_pathway_name_en", subpathway);
  if (region) query = query.eq("school_region", region);
  if (schoolType) query = query.eq("institution_type", schoolType);
  if (artisticRating) query = query.eq("artistic_rating", artisticRating);
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
    artistic_rating: artisticRating,
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

  const submissionRows = data ?? [];
  const submissionIds = submissionRows.map((submission: any) => String(submission.id));

  let commentsBySubmissionId = new Map<string, any[]>();
  let assignmentsBySubmissionId = new Map<string, any[]>();
  let workflowDataError: string | null = null;

  try {
    const workflowData = await loadSubmissionWorkflowData(submissionIds);
    commentsBySubmissionId = workflowData.commentsBySubmissionId;
    assignmentsBySubmissionId = workflowData.assignmentsBySubmissionId;
  } catch (error: any) {
    workflowDataError = error?.message ?? "Failed to load comments and task flow.";
  }

  const submissions = submissionRows.map((submission: any) => ({
    ...submission,
    __comments: commentsBySubmissionId.get(String(submission.id)) ?? [],
    __taskFlow: assignmentsBySubmissionId.get(String(submission.id)) ?? [],
  }));

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
            <span className="small">ADEK Artistic Rating</span>
            <select className="input" name="artistic_rating" defaultValue={artisticRating}>
              <option value="">All</option>
              {options.artisticRatings.map((x) => (
                <option key={x} value={x}>{labelArtisticRating(x)}</option>
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

      {workflowDataError && (
        <ErrorBox
          title="Workflow history warning:"
          message={workflowDataError}
          details="The submissions list loaded, but comments or task flow may be missing until this query is fixed."
        />
      )}

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