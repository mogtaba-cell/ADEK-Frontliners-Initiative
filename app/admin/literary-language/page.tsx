import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

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

export default async function LiteraryLanguagePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(["admin"]);
  const params = (await searchParams) ?? {};

  const saved = Array.isArray(params.saved) ? params.saved[0] : params.saved;
  const errorMessage = Array.isArray(params.error)
    ? params.error[0]
    : params.error;

  const { data, error } = await supabaseAdmin
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
      art_sub_pathway_name_en,
      participating_students_grades,
      literary_language,
      workflow_status,
      updated_at
      `
    )
    .or(
      [
        "art_pathway_name_en.ilike.%Literary%",
        "art_sub_pathway_name_en.ilike.%Literary%",
        "art_pathway_name_en.ilike.%Literary Expressions%",
        "art_sub_pathway_name_en.ilike.%Frontliner Tribute%",
        "art_pathway_name_ar.ilike.%الأدبية%",
        "art_sub_pathway_name_ar.ilike.%الأدبية%",
      ].join(",")
    )
    .order("literary_language", { ascending: true, nullsFirst: true })
    .order("updated_at", { ascending: false })
    .limit(500);

  const submissions = data ?? [];

  const notClassified = submissions.filter(
    (row: any) => !row.literary_language
  );

  const arabic = submissions.filter(
    (row: any) => row.literary_language === "arabic"
  );

  const englishOrOthers = submissions.filter(
    (row: any) => row.literary_language === "english_or_others"
  );

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="table-title-row">
        <div>
          <h1>Literary Language Classification</h1>

          <p className="muted">
            Classify literary submissions as Arabic or English/Others so the
            system can send them to the correct literary proofreader.
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
          <p className="stat-number">{notClassified.length}</p>
        </div>

        <div className="card">
          <strong>Arabic</strong>
          <p className="stat-number">{arabic.length}</p>
        </div>

        <div className="card">
          <strong>English or Others</strong>
          <p className="stat-number">{englishOrOthers.length}</p>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Could not load submissions</h2>
          <p className="muted">{error.message}</p>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Literary Submissions</h2>

          <p className="muted">
            Open the source file when needed to review the artwork before
            classifying the language.
          </p>

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
                    <td colSpan={7}>No literary submissions found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}