import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

// Only show approved submissions from the main "Literary Expressions" pathway.
// This avoids pulling Frontliner Tribute or other sub-pathways into the page.
const LITERARY_FILTER = [
  "art_pathway_name_en.ilike.%Literary Expressions%",
  "art_pathway_name_ar.ilike.%التعبيرات الأدبية%",
].join(",");

function displayText(value: unknown, fallback = "—") {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }

  return String(value);
}

function getTitle(submission: any) {
  return (
    submission.artwork_title_en ||
    submission.artwork_title_ar ||
    submission.reference_id ||
    "Untitled submission"
  );
}

function languageLabel(value: string | null | undefined) {
  if (value === "arabic") return "Arabic";
  if (value === "english_or_others") return "English or Others";
  return "Not classified";
}

function getSingleParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function buildPageHref(page: number) {
  return `/admin/literary-language?page=${page}`;
}

async function getLiteraryLanguageCount(
  language: "arabic" | "english_or_others" | null
) {
  let query = supabaseAdmin
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .or(LITERARY_FILTER)
    .eq("evaluation_decision", "approved");

  if (language === null) {
    query = query.is("literary_language", null);
  } else {
    query = query.eq("literary_language", language);
  }

  const { count } = await query;
  return count ?? 0;
}

export default async function LiteraryLanguagePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(["admin"]);
  const params = (await searchParams) ?? {};

  const pageParam = Number(getSingleParam(params, "page") ?? "1");
  const currentPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const saved = getSingleParam(params, "saved");
  const errorMessage = getSingleParam(params, "error");

  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const submissionsQuery = supabaseAdmin
    .from("submissions")
    .select(
      `
      id,
      reference_id,
      art_link,
      artwork_title_en,
      artwork_title_ar,
      description_en,
      description_ar,
      art_pathway_name_en,
      art_pathway_name_ar,
      art_sub_pathway_name_en,
      participating_students_grades,
      literary_language,
      workflow_status,
      evaluation_decision,
      updated_at
      `,
      { count: "exact" }
    )
    .or(LITERARY_FILTER)
    .eq("evaluation_decision", "approved")
    .order("literary_language", { ascending: true, nullsFirst: true })
    .order("updated_at", { ascending: false })
    .range(from, to);

  const [
    submissionsResult,
    notClassifiedCount,
    arabicCount,
    englishOrOthersCount,
  ] = await Promise.all([
    submissionsQuery,
    getLiteraryLanguageCount(null),
    getLiteraryLanguageCount("arabic"),
    getLiteraryLanguageCount("english_or_others"),
  ]);

  const { data, error, count } = submissionsResult;

  const submissions = data ?? [];
  const totalSubmissions = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalSubmissions / PAGE_SIZE));

  const safeCurrentPage = Math.min(currentPage, totalPages);
  const showingFrom = totalSubmissions === 0 ? 0 : from + 1;
  const showingTo = Math.min(from + submissions.length, totalSubmissions);

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="table-title-row">
        <div>
          <h1>Literary Language Classification</h1>

          <p className="muted">
            Classify approved Literary Expressions submissions as Arabic or
            English/Others so the system can send them to the correct literary
            proofreader.
          </p>
        </div>
      </div>

      {saved && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="pill">Language classification saved.</p>
        </div>
      )}

      {errorMessage && (
        <div
          className="card"
          style={{
            marginTop: 16,
            background: "#fff1f1",
            border: "1px solid #d88",
          }}
        >
          <strong>Error:</strong>{" "}
          <span className="muted">{decodeURIComponent(errorMessage)}</span>
        </div>
      )}

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <div className="card">
          <strong>Not Classified</strong>
          <p className="stat-number">{notClassifiedCount}</p>
        </div>

        <div className="card">
          <strong>Arabic</strong>
          <p className="stat-number">{arabicCount}</p>
        </div>

        <div className="card">
          <strong>English or Others</strong>
          <p className="stat-number">{englishOrOthersCount}</p>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Could not load submissions</h2>
          <p className="muted">{error.message}</p>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="table-title-row">
            <div>
              <h2>Approved Literary Expressions Submissions</h2>

              <p className="muted">
                Showing {showingFrom}–{showingTo} of {totalSubmissions} approved
                Literary Expressions submissions. Each page loads {PAGE_SIZE}
                records only.
              </p>
            </div>

            <div className="actions">
              <span className="pill">
                Page {safeCurrentPage} of {totalPages}
              </span>
            </div>
          </div>

          <p className="muted">
            Open the source file when needed to review the artwork before
            classifying the language.
          </p>

          <div className="actions" style={{ marginBottom: 16 }}>
            {safeCurrentPage > 1 ? (
              <Link
                className="btn secondary"
                href={buildPageHref(safeCurrentPage - 1)}
              >
                Previous
              </Link>
            ) : (
              <button className="btn secondary" type="button" disabled>
                Previous
              </button>
            )}

            {safeCurrentPage < totalPages ? (
              <Link
                className="btn secondary"
                href={buildPageHref(safeCurrentPage + 1)}
              >
                Next
              </Link>
            ) : (
              <button className="btn secondary" type="button" disabled>
                Next
              </button>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Artwork</th>
                  <th>Reference ID</th>
                  <th>Pathway</th>
                  <th>Grade</th>
                  <th>Source File</th>
                  <th>Current Language</th>
                  <th>Classify</th>
                </tr>
              </thead>

              <tbody>
                {submissions.map((submission: any) => (
                  <tr key={submission.id}>
                    <td>
                      <strong dir="auto">{getTitle(submission)}</strong>

                      <div className="muted small" dir="auto">
                        {displayText(
                          submission.description_en || submission.description_ar
                        )}
                      </div>
                    </td>

                    <td>{displayText(submission.reference_id)}</td>

                    <td>
                      {displayText(submission.art_pathway_name_en)}

                      <div className="muted small">
                        {displayText(submission.art_sub_pathway_name_en)}
                      </div>
                    </td>

                    <td>
                      {displayText(submission.participating_students_grades)}
                    </td>

                    <td>
                      {submission.art_link ? (
                        <a
                          className="btn secondary"
                          href={submission.art_link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open Source File
                        </a>
                      ) : (
                        <span className="muted small">No source file</span>
                      )}
                    </td>

                    <td>
                      <span className="pill">
                        {languageLabel(submission.literary_language)}
                      </span>
                    </td>

                    <td>
                      <form
                        action="/api/admin/literary-language"
                        method="post"
                        className="actions"
                      >
                        <input
                          type="hidden"
                          name="submission_id"
                          value={submission.id}
                        />

                        <input
                          type="hidden"
                          name="page"
                          value={safeCurrentPage}
                        />

                        <select
                          className="input compact-input"
                          name="literary_language"
                          defaultValue={submission.literary_language ?? ""}
                          required
                        >
                          <option value="">Select</option>
                          <option value="arabic">Arabic</option>
                          <option value="english_or_others">
                            English or Others
                          </option>
                        </select>

                        <button className="btn secondary" type="submit">
                          Save
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}

                {submissions.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      No approved Literary Expressions submissions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="actions" style={{ marginTop: 16 }}>
            {safeCurrentPage > 1 ? (
              <Link
                className="btn secondary"
                href={buildPageHref(safeCurrentPage - 1)}
              >
                Previous
              </Link>
            ) : (
              <button className="btn secondary" type="button" disabled>
                Previous
              </button>
            )}

            {safeCurrentPage < totalPages ? (
              <Link
                className="btn secondary"
                href={buildPageHref(safeCurrentPage + 1)}
              >
                Next
              </Link>
            ) : (
              <button className="btn secondary" type="button" disabled>
                Next
              </button>
            )}

            <span className="pill">
              Page {safeCurrentPage} of {totalPages}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}