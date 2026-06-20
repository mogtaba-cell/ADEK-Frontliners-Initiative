import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { ARTISTIC_RUBRIC_CRITERIA } from "@/lib/rater-rubric";

export const dynamic = "force-dynamic";

export default async function RaterHomePage() {
  const user = await requireUser(["rater"]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="card">
        <h1>Artistic Grading Criteria</h1>
        <p className="muted">
          Use this guide before opening your workspace. Raters now score each
          criterion out of 100, and the system applies the rubric weights
          automatically to calculate the final artistic rating.
        </p>

        <div className="actions" style={{ marginTop: 16 }}>
          <Link className="btn" href="/rater/workspace">
            Open Artistic Grading Workspace
          </Link>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        {ARTISTIC_RUBRIC_CRITERIA.map((criterion) => (
          <div className="card" key={criterion.id}>
            <h2 style={{ marginTop: 0 }}>{criterion.title}</h2>
            <p dir="rtl" style={{ fontWeight: 800 }}>
              {criterion.titleAr}
            </p>
            <p className="pill pill-info">Score 0-100 · Weight {criterion.weight}%</p>
            <p className="muted">{criterion.description}</p>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Final Classification Matrix</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Total Points</th>
                <th>Final Artistic Rating</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>99-100</td>
                <td>Outstanding</td>
              </tr>
              <tr>
                <td>90-98</td>
                <td>Excellent</td>
              </tr>
              <tr>
                <td>75-89</td>
                <td>Very Good</td>
              </tr>
              <tr>
                <td>41-74</td>
                <td>Average</td>
              </tr>
              <tr>
                <td>1-40</td>
                <td>Weak</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Note: the supplied matrix did not assign a rating for scores 66-74, so
          the platform treats 41-74 as Average to keep every score mapped to a
          final display value. The weighted total is rounded to the nearest whole number.
        </p>
      </div>
    </main>
  );
}
