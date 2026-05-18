import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import Link from "next/link";

export const dynamic = "force-dynamic";

function CriteriaCard({
  letter,
  title,
  arabicLetter,
  arabicTitle,
  children,
  arabic,
}: {
  letter: string;
  title: string;
  arabicLetter: string;
  arabicTitle: string;
  children: React.ReactNode;
  arabic: React.ReactNode;
}) {
  return (
    <div
      className="card"
      style={{
        boxShadow: "none",
        border: "1px solid rgba(28, 62, 59, 0.14)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            minWidth: 48,
            height: 48,
            borderRadius: 16,
            background: "rgba(178, 199, 192, 0.55)",
            display: "grid",
            placeItems: "center",
            fontWeight: 900,
            fontSize: 24,
            color: "#073a3a",
          }}
        >
          {letter}
        </div>

        <div style={{ flex: 1 }}>
          <h3 style={{ marginTop: 0, marginBottom: 10 }}>{title}</h3>
          <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
            {children}
          </p>

          <div
            dir="rtl"
            style={{
              marginTop: 18,
              paddingTop: 18,
              borderTop: "1px solid rgba(28, 62, 59, 0.12)",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 10 }}>
              {arabicLetter}. {arabicTitle}
            </h3>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.9 }}>
              {arabic}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DecisionRow({
  result,
  decision,
  tone,
}: {
  result: string;
  decision: string;
  tone: "approved" | "review" | "disqualified";
}) {
  const background =
    tone === "approved"
      ? "rgba(178, 199, 192, 0.5)"
      : tone === "review"
        ? "rgba(255, 226, 153, 0.5)"
        : "rgba(255, 190, 190, 0.45)";

  const color =
    tone === "approved"
      ? "#073a3a"
      : tone === "review"
        ? "#7a4d00"
        : "#8a1f1f";

  return (
    <tr>
      <td style={{ fontWeight: 800 }}>{result}</td>
      <td>
        <span
          className="pill"
          style={{
            background,
            color,
          }}
        >
          {decision}
        </span>
      </td>
    </tr>
  );
}

export default async function EvaluatorCriteriaPage() {
  const user = await requireUser(["evaluator", "admin"]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <section
        className="card"
        style={{
          marginTop: 16,
          background:
            "linear-gradient(135deg, rgba(255,250,244,1) 0%, rgba(236,243,240,0.78) 100%)",
        }}
      >
        <div className="table-title-row">
          <div>
            <p className="pill" style={{ marginBottom: 12 }}>
              ADEK Evaluation
            </p>

            <h1 style={{ marginTop: 0, marginBottom: 8 }}>
              Evaluation Criteria
            </h1>

            <p className="muted" style={{ maxWidth: 920, lineHeight: 1.6 }}>
              Use these criteria when evaluating each artwork. The system will
              calculate the workflow decision automatically based on the Yes/No
              answers in the evaluation workspace.
            </p>
          </div>

          <Link className="btn" href="/evaluator/work">
            Open Evaluation Workspace
          </Link>
        </div>
      </section>

      <div className="grid grid-2 analytics-section">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Artwork File Quality Check</h2>

          <p className="muted" style={{ lineHeight: 1.7 }}>
            Before using the rubric, confirm whether the submitted image, video,
            or audio file is clear enough to evaluate. If the file is not clear
            enough, send the artwork to the Coordinator for correction.
          </p>
        </div>

        <div className="card" dir="rtl">
          <h2 style={{ marginTop: 0 }}>التحقق من جودة ملف العمل الفني</h2>

          <p className="muted" style={{ lineHeight: 1.9 }}>
            قبل استخدام معايير التقييم، يجب التأكد مما إذا كان ملف الصورة أو
            الفيديو أو الصوت المرفق واضحًا بما يكفي للتقييم. إذا لم يكن الملف
            واضحًا بما يكفي، يتم إرسال العمل الفني إلى المنسق للتصحيح.
          </p>
        </div>
      </div>

      <section className="card analytics-section">
        <div className="table-title-row">
          <div>
            <h2 style={{ marginTop: 0 }}>Evaluation Criteria</h2>
            <p className="muted">
              Review the three required criteria before making your Yes/No
              selections.
            </p>
          </div>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <CriteriaCard
            letter="A"
            title="Cultural Authenticity"
            arabicLetter="أ"
            arabicTitle="الأصالة الثقافية"
            arabic={
              <>
                تمثيل دقيق ومحترم وهادف لهوية دولة الإمارات العربية المتحدة
                وتراثها وقيمها وعناصرها الثقافية، والتأكد من توافقها مع الجوانب
                الثقافية وقيم المجتمع الإماراتي ومعايير الهوية الوطنية.
              </>
            }
          >
            Accurate, respectful, and meaningful representation of UAE identity,
            heritage, values, and cultural elements, while ensuring alignment
            with cultural aspects, UAE community values, and national identity
            standards.
          </CriteriaCard>

          <CriteriaCard
            letter="B"
            title="Artistic Excellence / Quality & Relevance"
            arabicLetter="ب"
            arabicTitle="التميز الفني / الجودة والارتباط بالموضوع"
            arabic={
              <>
                عمل إبداعي متقن التنفيذ، ويرتبط بوضوح بموضوع وأهداف المبادرة،
                ويصلح للعرض العام الاحترافي.
              </>
            }
          >
            A creatively executed and well-crafted artwork that is clearly
            connected to the theme and objectives of the initiative and is
            suitable for professional public display.
          </CriteriaCard>

          <CriteriaCard
            letter="C"
            title="Ethical & Public Appropriateness"
            arabicLetter="ج"
            arabicTitle="الملاءمة الأخلاقية والعامة"
            arabic={
              <>
                محتوى يحترم الجميع، وشامل، ومناسب للفئات العمرية، ومتوافق مع
                القيم التعليمية والاجتماعية والمجتمعية، مع مراعاة بيئة العمل،
                وخلو العمل من الأخطاء المحرجة.
              </>
            }
          >
            Respectful, inclusive, and age-appropriate content that aligns with
            educational, social, and community values, while maintaining an
            appropriate work environment and being free from embarrassing or
            inappropriate errors.
          </CriteriaCard>
        </div>
      </section>

      <section className="card analytics-section">
        <div className="table-title-row">
          <div>
            <h2 style={{ marginTop: 0 }}>Decision Logic</h2>
            <p className="muted">
              The system applies this logic automatically after the evaluator
              answers A, B, and C.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Criteria Result</th>
                <th>System Decision</th>
              </tr>
            </thead>

            <tbody>
              <DecisionRow
                result="A = Yes, B = Yes, C = Yes"
                decision="Approved"
                tone="approved"
              />

              <DecisionRow
                result="A = No"
                decision="Disqualified"
                tone="disqualified"
              />

              <DecisionRow
                result="C = No"
                decision="Disqualified"
                tone="disqualified"
              />

              <DecisionRow
                result="B = No, while A = Yes and C = Yes"
                decision="Needs Review"
                tone="review"
              />
            </tbody>
          </table>
        </div>

        <div
          className="submission-text-block"
          style={{
            marginTop: 18,
            background: "rgba(178, 199, 192, 0.22)",
          }}
        >
          <strong>Management Review Note</strong>
          <div>
            If the artwork is marked Needs Review, it goes to Management.
            Management may approve or disqualify the artwork, and Management’s
            decision overwrites the evaluator decision.
          </div>
        </div>
      </section>

      <section className="card analytics-section">
        <div className="table-title-row">
          <div>
            <h2 style={{ marginTop: 0 }}>Artistic Rating</h2>
            <p className="muted">
              The artistic rating records the overall artistic level. It does not
              affect the automatic workflow decision.
            </p>
          </div>
        </div>

        <div className="grid grid-2">
          <div
            className="submission-text-block"
            style={{ background: "rgba(178, 199, 192, 0.22)" }}
          >
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

          <div
            className="submission-text-block"
            dir="rtl"
            style={{ background: "rgba(178, 199, 192, 0.22)" }}
          >
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

        <div className="grid grid-4" style={{ marginTop: 16 }}>
          <div className="card" style={{ boxShadow: "none" }}>
            <strong>Weak</strong>
            <p dir="rtl" className="stat-number" style={{ fontSize: 24 }}>
              ضعيف
            </p>
          </div>

          <div className="card" style={{ boxShadow: "none" }}>
            <strong>Medium</strong>
            <p dir="rtl" className="stat-number" style={{ fontSize: 24 }}>
              متوسط
            </p>
          </div>

          <div className="card" style={{ boxShadow: "none" }}>
            <strong>Good</strong>
            <p dir="rtl" className="stat-number" style={{ fontSize: 24 }}>
              جيد
            </p>
          </div>

          <div className="card" style={{ boxShadow: "none" }}>
            <strong>Excellent</strong>
            <p dir="rtl" className="stat-number" style={{ fontSize: 24 }}>
              ممتاز
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}