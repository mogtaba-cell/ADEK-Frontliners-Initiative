import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";

export const dynamic = "force-dynamic";

const criteria = [
  {
    title: "Artistic Quality & Creativity",
    titleAr: "الجودة الفنية والإبداع",
    weight: 50,
    english: [
      "Technical skill and mastery of the chosen artistic form or medium",
      "Quality of execution, craftsmanship, or performance",
      "Structure, composition, or organization",
      "Creative thinking and originality of ideas",
      "Effective use of artistic elements, language, movement, sound, or digital media, as relevant",
      "Attention to detail and refinement",
      "Emotional, intellectual, or aesthetic impact on the audience",
      "The student's effort in developing and expressing their artistic vision",
    ],
    arabic: [
      "المهارة الفنية وإتقان المجال أو الوسيط الفني المستخدم.",
      "جودة التنفيذ أو الحرفية أو الأداء.",
      "البناء الفني، أو التكوين، أو التنظيم.",
      "التفكير الإبداعي والأصالة في الطرح.",
      "الاستخدام الفعّال للعناصر الفنية أو اللغة أو الحركة أو الصوت أو الوسائط الرقمية، بحسب طبيعة التقديم.",
      "الاهتمام بالتفاصيل ومستوى الإتقان.",
      "الأثر الجمالي أو الفكري أو العاطفي الذي يتركه العمل لدى المتلقي.",
      "الجهد المبذول من قبل الطالب في تطوير رؤيته الفنية والتعبير عنها.",
    ],
  },
  {
    title: "Relation to the Initiative",
    titleAr: "الارتباط بموضوع المبادرة",
    weight: 35,
    english: [
      "Clear message related to the initiative subject",
      "Innovative use of ideas, symbols, materials, or techniques",
    ],
    arabic: [
      "وضوح الرسالة وارتباطها بموضوع المبادرة.",
      "الاستخدام الإبداعي للأفكار أو الرموز أو الخامات أو التقنيات لإيصال الرسالة.",
    ],
  },
  {
    title: "Age Appropriateness",
    titleAr: "الملاءمة العمرية",
    weight: 15,
    english: [
      "Achievement relative to age or grade level",
      "Student's performance or artistic output is appropriate for their age group",
    ],
    arabic: [
      "مستوى الإنجاز مقارنةً بالعمر أو المرحلة الدراسية.",
      "مستوى الأداء أو الإنتاج الفني للفئة العمرية للطالب.",
    ],
  },
];

const classificationRows = [
  ["99-100", "Outstanding"],
  ["90-98", "Excellent"],
  ["75-89", "Very Good"],
  ["41-74", "Average"],
  ["1-40", "Weak"],
];

export default async function RaterHomePage() {
  const user = await requireUser(["rater"]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="card">
        <h1>Artistic Grading Criteria</h1>
        <p className="muted">
          Use this guide before opening your workspace. Raters score each criterion
          out of 100, and the system applies the rubric weights automatically to
          calculate the final artistic rating.
        </p>

        <p className="muted" dir="rtl">
          استخدم هذا الدليل قبل فتح مساحة العمل. يقوم المقيم بإدخال درجة من 100
          لكل معيار، ويقوم النظام بتطبيق الأوزان تلقائيًا لاحتساب التصنيف الفني النهائي.
        </p>

        <div className="actions" style={{ marginTop: 16 }}>
          <Link className="btn" href="/rater/workspace">
            Open Artistic Grading Workspace
          </Link>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        {criteria.map((criterion) => (
          <div className="card" key={criterion.title}>
            <h2 style={{ marginTop: 0 }}>{criterion.title}</h2>
            <h3 dir="rtl" style={{ marginTop: 0 }}>
              {criterion.titleAr}
            </h3>
            <p className="pill pill-info">
              Score 0-100 · Weight {criterion.weight}%
            </p>

            <div style={{ marginTop: 16 }}>
              <strong>What is being assessed?</strong>
              <ul style={{ paddingLeft: 18 }}>
                {criterion.english.map((item) => (
                  <li key={item} className="muted" style={{ marginTop: 6 }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div dir="rtl" style={{ marginTop: 16 }}>
              <strong>ما الذي يتم تقييمه؟</strong>
              <ul style={{ paddingRight: 18 }}>
                {criterion.arabic.map((item) => (
                  <li key={item} className="muted" style={{ marginTop: 6 }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Final Classification Matrix</h2>
        <p className="muted" dir="rtl">
          مصفوفة التصنيف النهائي حسب مجموع النقاط.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Total Points</th>
                <th>Final Artistic Rating</th>
              </tr>
            </thead>
            <tbody>
              {classificationRows.map(([points, rating]) => (
                <tr key={points}>
                  <td>{points}</td>
                  <td>{rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          The platform treats 41-74 as Average so that every valid weighted score
          has a final display rating. The weighted total is rounded to the nearest
          whole number.
        </p>
      </div>
    </main>
  );
}
