import Link from "next/link";
import { Nav } from "@/components/nav";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function EvaluatorHomePage() {
  const user = await requireUser(["evaluator", "admin"]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="table-title-row">
        <div>
          <h1>ADEK Evaluation Criteria</h1>
          <p className="muted">
            Review the evaluation workflow, quality check, decision rules, and
            artistic rating before starting your assigned artworks.
          </p>
        </div>

        <Link className="btn" href="/evaluator/work">
          Start Evaluating
        </Link>
      </div>

      <div className="grid grid-2 analytics-section">
        <div className="card">
          <h2>1. Artwork File Quality Check</h2>

          <p>
            Before using the evaluation rubric, you must first confirm whether
            the submitted artwork file can be evaluated clearly.
          </p>

          <div className="submission-text-block">
            <strong>
              Can this artwork be evaluated based on the quality and clarity of
              the submitted image, video, or audio file?
            </strong>

            <div dir="rtl">
              هل يمكن تقييم العمل الفني بناءً على جودة ووضوح ملف الصورة أو
              الفيديو أو الصوت المرفق؟
            </div>
          </div>

          <p className="muted">
            If the answer is <strong>No</strong>, do not evaluate the artwork.
            Send it to the Coordinator for correction. Once the Coordinator
            finishes the correction, the artwork will return to you for
            evaluation.
          </p>
        </div>

        <div className="card">
          <h2>2. Artistic Rating</h2>

          <p>
            The artistic rating records the overall artistic level of the
            artwork. It does not affect the automatic workflow decision.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>English</th>
                  <th>Arabic</th>
                </tr>
              </thead>

              <tbody>
                <tr>
                  <td>Weak</td>
                  <td dir="rtl">ضعيف</td>
                </tr>
                <tr>
                  <td>Medium</td>
                  <td dir="rtl">متوسط</td>
                </tr>
                <tr>
                  <td>Good</td>
                  <td dir="rtl">جيد</td>
                </tr>
                <tr>
                  <td>Excellent</td>
                  <td dir="rtl">ممتاز</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="muted small" style={{ marginTop: 12 }}>
            If the artwork is sent to Management for review, Management may
            overwrite the artistic rating.
          </p>
        </div>
      </div>

      <div className="card analytics-section">
        <h2>Evaluation Rubric</h2>

        <div className="grid grid-3">
          <div className="submission-text-block">
            <strong>A. Cultural Authenticity</strong>

            <div>
              Accurate, respectful, and meaningful representation of UAE
              identity, heritage, values, and cultural elements.
            </div>

            <strong style={{ marginTop: 14 }} dir="rtl">
              أ. الأصالة الثقافية
            </strong>

            <div dir="rtl">
              تمثيل دقيق ومحترم وهادف لهوية دولة الإمارات العربية المتحدة
              وتراثها وقيمها وعناصرها الثقافية.
            </div>
          </div>

          <div className="submission-text-block">
            <strong>B. Artistic Excellence / Quality & Relevance</strong>

            <div>
              Visually compelling, original, well-executed, and clearly
              connected to the theme and objectives of the initiative; suitable
              for professional public display.
            </div>

            <strong style={{ marginTop: 14 }} dir="rtl">
              ب. التميز الفني / الجودة والارتباط بالموضوع
            </strong>

            <div dir="rtl">
              عمل بصري جاذب وأصيل ومتقن التنفيذ، ويرتبط بوضوح بموضوع وأهداف
              المبادرة، ويصلح للعرض العام الاحترافي.
            </div>
          </div>

          <div className="submission-text-block">
            <strong>C. Ethical & Public Appropriateness</strong>

            <div>
              Respectful, inclusive, age-appropriate, and aligned with
              educational, social, and community values, while also reflecting
              cleanliness in the student’s presentation and environment, and
              being free from major spelling errors.
            </div>

            <strong style={{ marginTop: 14 }} dir="rtl">
              ج. الملاءمة الأخلاقية والعامة
            </strong>

            <div dir="rtl">
              محتوى يحترم الجميع، وشامل، ومناسب للفئات العمرية، ومتوافق مع
              القيم التعليمية والاجتماعية والمجتمعية، مع مراعاة نظافة الطالب
              وبيئة العمل، وخلو العمل من الأخطاء الإملائية الجسيمة.
            </div>
          </div>
        </div>
      </div>

      <div className="card analytics-section">
        <h2>Decision Rules</h2>

        <p className="muted">
          The system calculates the workflow decision automatically based on the
          three rubric answers.
        </p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cultural Authenticity</th>
                <th>Artistic Excellence</th>
                <th>Ethical & Public Appropriateness</th>
                <th>Decision</th>
                <th>Next Step</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>Yes</td>
                <td>Yes</td>
                <td>Yes</td>
                <td>
                  <span className="pill">Approved</span>
                </td>
                <td>Continues to proofreading stage.</td>
              </tr>

              <tr>
                <td>No</td>
                <td>Any</td>
                <td>Any</td>
                <td>
                  <span
                    className="pill"
                    style={{
                      background: "#fff1f1",
                      color: "#9b2f2f",
                    }}
                  >
                    Disqualified
                  </span>
                </td>
                <td>Artwork is removed from the workflow.</td>
              </tr>

              <tr>
                <td>Any</td>
                <td>Any</td>
                <td>No</td>
                <td>
                  <span
                    className="pill"
                    style={{
                      background: "#fff1f1",
                      color: "#9b2f2f",
                    }}
                  >
                    Disqualified
                  </span>
                </td>
                <td>Artwork is removed from the workflow.</td>
              </tr>

              <tr>
                <td>Yes</td>
                <td>No</td>
                <td>Yes</td>
                <td>
                  <span
                    className="pill"
                    style={{
                      background: "#fff8ec",
                      color: "#8a5b13",
                    }}
                  >
                    Needs Management Review
                  </span>
                </td>
                <td>
                  Sent to Management. Management makes the final decision and
                  may overwrite the artistic rating.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2 analytics-section">
        <div className="card">
          <h2>When to Send for Correction</h2>

          <p>
            Send the artwork to the Coordinator only when the submitted file is
            not clear enough to evaluate.
          </p>

          <ul>
            <li>The image is too blurry or unclear.</li>
            <li>The video cannot be properly viewed.</li>
            <li>The audio cannot be properly heard.</li>
            <li>The file is corrupted or does not open correctly.</li>
            <li>
              The submitted file quality prevents a fair evaluation of the
              artwork.
            </li>
          </ul>

          <p className="muted">
            After the Coordinator updates the artwork or supporting file, the
            same artwork will return to you.
          </p>
        </div>

        <div className="card">
          <h2>Management Review</h2>

          <p>
            Management receives artworks that need review when the artwork is
            culturally authentic and ethically appropriate, but does not meet the
            artistic excellence requirement.
          </p>

          <div className="submission-text-block">
            <strong>Management receives:</strong>
            <div>
              A = Yes, B = No, C = Yes → Needs Management Review
            </div>
          </div>

          <p className="muted">
            Management does not return ADEK review cases back to evaluators.
            Management either approves the artwork so it continues to
            proofreading, or disqualifies it.
          </p>
        </div>
      </div>

      <div className="actions analytics-section">
        <Link className="btn" href="/evaluator/work">
          Start Evaluating
        </Link>
      </div>
    </main>
  );
}