import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EvaluatorCriteriaPage() {
  const user = await requireUser(["evaluator", "admin"]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="table-title-row">
        <div>
          <h1>ADEK Evaluation Criteria</h1>
          <p className="muted">
            Use these criteria when evaluating each artwork. The system will
            calculate the workflow decision automatically based on the Yes/No
            answers in the evaluation workspace.
          </p>
        </div>

        <Link className="btn" href="/evaluator/work">
          Open Evaluation Workspace
        </Link>
      </div>

      <div className="card">
        <h2>Evaluation Flow</h2>

        <div className="grid grid-2">
          <div className="submission-text-block">
            <strong>Artwork File Quality Check</strong>
            <div>
              Before using the rubric, confirm whether the submitted image,
              video, or audio file is clear enough to evaluate.
              <br />
              If the file is not clear enough, send the artwork to the
              Coordinator for correction.
            </div>
          </div>

          <div className="submission-text-block" dir="rtl">
            <strong>التحقق من جودة ملف العمل الفني</strong>
            <div>
              قبل استخدام معايير التقييم، يجب التأكد مما إذا كان ملف الصورة أو
              الفيديو أو الصوت المرفق واضحًا بما يكفي للتقييم.
              <br />
              إذا لم يكن الملف واضحًا بما يكفي، يتم إرسال العمل الفني إلى
              المنسق للتصحيح.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Decision Logic</h2>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Criteria Result</th>
                <th>System Decision</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>A = Yes, B = Yes, C = Yes</td>
                <td>
                  <span className="pill">Approved</span>
                </td>
              </tr>

              <tr>
                <td>A = No</td>
                <td>
                  <span className="pill">Disqualified</span>
                </td>
              </tr>

              <tr>
                <td>C = No</td>
                <td>
                  <span className="pill">Disqualified</span>
                </td>
              </tr>

              <tr>
                <td>B = No, while A = Yes and C = Yes</td>
                <td>
                  <span className="pill">Needs Review</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="muted small" style={{ marginTop: 12 }}>
          If the artwork is marked Needs Review, it goes to Management. Management
          may approve or disqualify the artwork, and Management’s decision
          overwrites the evaluator decision.
        </p>
      </div>

      <div className="card">
        <h2>Evaluation Criteria</h2>

        <div className="grid">
          <div className="submission-text-block">
            <strong>A. Cultural Authenticity</strong>
            <div>
              Accurate, respectful, and meaningful representation of UAE
              identity, heritage, values, and cultural elements, while ensuring
              alignment with cultural aspects, UAE community values, and national
              identity standards.
            </div>

            <strong dir="rtl" style={{ display: "block", marginTop: 14 }}>
              أ. الأصالة الثقافية
            </strong>
            <div dir="rtl">
              تمثيل دقيق ومحترم وهادف لهوية دولة الإمارات العربية المتحدة
              وتراثها وقيمها وعناصرها الثقافية، والتأكد من توافقها مع الجوانب
              الثقافية وقيم المجتمع الإماراتي ومعايير الهوية الوطنية.
            </div>
          </div>

          <div className="submission-text-block">
            <strong>B. Artistic Excellence / Quality & Relevance</strong>
            <div>
              A creatively executed and well-crafted artwork that is clearly
              connected to the theme and objectives of the initiative and is
              suitable for professional public display.
            </div>

            <strong dir="rtl" style={{ display: "block", marginTop: 14 }}>
              ب. التميز الفني / الجودة والارتباط بالموضوع
            </strong>
            <div dir="rtl">
              عمل إبداعي متقن التنفيذ، ويرتبط بوضوح بموضوع وأهداف المبادرة،
              ويصلح للعرض العام الاحترافي.
            </div>
          </div>

          <div className="submission-text-block">
            <strong>C. Ethical & Public Appropriateness</strong>
            <div>
              Respectful, inclusive, and age-appropriate content that aligns with
              educational, social, and community values, while maintaining an
              appropriate work environment and being free from embarrassing or
              inappropriate errors.
            </div>

            <strong dir="rtl" style={{ display: "block", marginTop: 14 }}>
              ج. الملاءمة الأخلاقية والعامة
            </strong>
            <div dir="rtl">
              محتوى يحترم الجميع، وشامل، ومناسب للفئات العمرية، ومتوافق مع القيم
              التعليمية والاجتماعية والمجتمعية، مع مراعاة بيئة العمل، وخلو العمل
              من الأخطاء المحرجة.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Artistic Rating</h2>

        <div className="grid grid-2">
          <div className="submission-text-block">
            <strong>Artistic Rating</strong>
            <div>
              Record the overall artistic level of the submitted artwork. This
              rating does not affect the automatic judging workflow.
              <br />
              <br />
              If the artwork is sent to Management for review, Management may
              modify the artistic rating.
            </div>
          </div>

          <div className="submission-text-block" dir="rtl">
            <strong>التقييم الفني:</strong>
            <div>
              قم بتسجيل التقييم الفني المستوى الفني العام للعمل المقدم. لا يؤثر
              هذا التقييم على سير العمل التلقائي للتحكيم.
              <br />
              <br />
              في حال تم إرسال العمل الفني إلى الإدارة للمراجعة، فقد تقوم الإدارة
              بتعديل التقييم الفني.
            </div>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 16 }}>
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
      </div>
    </main>
  );
}