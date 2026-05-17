import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decisionLabel } from "@/lib/decision";
import { labelWorkflowStatus, labelPhase } from "@/lib/workflow";

export const dynamic = "force-dynamic";

async function getAssignment(assignmentId: string | undefined, userId: string) {
  if (!assignmentId) return null;
  const { data } = await supabaseAdmin
    .from("assignments")
    .select("id,phase,status,assigned_to,created_at,started_at,completed_at")
    .eq("id", assignmentId)
    .maybeSingle();

  if (data && data.assigned_to === userId && data.status === "assigned") {
    await supabaseAdmin.from("assignments").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", assignmentId);
    return { ...data, status: "in_progress" };
  }

  return data;
}

function yesNoSelect(name: string, label: string, description: string) {
  return (
    <label>
      <strong>{label}</strong>
      <p className="muted small">{description}</p>
      <select className="input" name={name} required defaultValue="">
        <option value="" disabled>Select Yes or No</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function rawDataTable(rawData: any) {
  if (!rawData || typeof rawData !== "object") return null;
  const entries = Object.entries(rawData).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
  if (!entries.length) return null;
  return (
    <details className="card" style={{ marginTop: 16 }}>
      <summary><strong>View all imported source fields</strong></summary>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <tbody>
            {entries.map(([key, value]) => <tr key={key}><th>{key}</th><td>{String(value)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default async function WorkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const assignmentId = Array.isArray(query.assignment) ? query.assignment[0] : query.assignment;

  const { data: s, error } = await supabaseAdmin.from("submissions").select("*").eq("id", id).single();
  if (error || !s) throw new Error("Submission not found");

  const assignment = await getAssignment(assignmentId, user.id);

  const [{ data: comments }, { data: evaluations }, { data: managementReviews }, { data: proofreading }, { data: finalReviews }] = await Promise.all([
    supabaseAdmin.from("comments").select("comment_text,created_at,profiles(full_name,role)").eq("submission_id", id).order("created_at", { ascending: false }),
    supabaseAdmin.from("evaluations").select("*,profiles(full_name)").eq("submission_id", id).order("created_at", { ascending: false }),
    supabaseAdmin.from("management_reviews").select("*,profiles(full_name)").eq("submission_id", id).order("created_at", { ascending: false }),
    supabaseAdmin.from("proofreading_tasks").select("*,profiles(full_name)").eq("submission_id", id).maybeSingle(),
    supabaseAdmin.from("final_reviews").select("*,profiles(full_name)").eq("submission_id", id).maybeSingle(),
  ]);

  const baseHidden = (
    <>
      <input type="hidden" name="submission_id" value={id} />
      {assignment?.id && <input type="hidden" name="assignment_id" value={assignment.id} />}
    </>
  );

  return (
    <main className="container">
      <Nav role={user.role} />
      <div className="actions" style={{ marginBottom: 16 }}>
        <Link className="btn secondary" href={user.role === "admin" ? "/submissions" : `/${user.role}`}>Back</Link>
        {s.art_link && <a className="btn" target="_blank" href={s.art_link}>Open Source File</a>}
      </div>

      <div className="card">
        <h1>{s.reference_id}</h1>
        <div className="filter-summary">
          <span className="pill">{labelWorkflowStatus(s.workflow_status)}</span>
          {assignment?.phase && <span className="pill">{labelPhase(assignment.phase)}</span>}
          {assignment?.status && <span className="pill">Assignment: {assignment.status}</span>}
        </div>

        <h2>Submission Details</h2>
        <dl className="detail-grid">
          <dt>Reference ID</dt><dd>{s.reference_id}</dd>
          <dt>Registration Status</dt><dd>{s.registration_status}</dd>
          <dt>Submission Date</dt><dd>{s.submission_date}</dd>
          <dt>School</dt><dd>{s.institution_name}</dd>
          <dt>School Type</dt><dd>{s.institution_type}</dd>
          <dt>Region</dt><dd>{s.school_region}</dd>
          <dt>Pathway</dt><dd>{s.art_pathway_name_en}</dd>
          <dt>Subpathway</dt><dd>{s.art_sub_pathway_name_en}</dd>
          <dt>English Title</dt><dd>{s.artwork_title_en}</dd>
          <dt>Arabic Title</dt><dd>{s.artwork_title_ar}</dd>
          <dt>English Description</dt><dd>{s.description_en}</dd>
          <dt>Arabic Description</dt><dd>{s.description_ar}</dd>
          <dt>Students ESIS</dt><dd>{s.participating_students_esis_numbers}</dd>
          <dt>Students Names</dt><dd>{s.participating_students_names}</dd>
          <dt>Students Grades</dt><dd>{s.participating_students_grades}</dd>
          <dt>Genders</dt><dd>{s.participating_students_genders}</dd>
          <dt>Nationalities</dt><dd>{s.participating_students_nationalities}</dd>
        </dl>
      </div>

      {user.role === "coordinator" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Coordinator Check</h2>
          <p className="muted">Check that the submitted artwork data is complete and accurate before ADEK evaluation.</p>
          <form action="/api/workflow" method="post" className="grid">
            {baseHidden}
            <textarea className="input" name="comment" placeholder="Coordinator comments / missing fields / school clarification notes" />
            <div className="actions">
              <button className="btn" name="action" value="coordinator_ready">Mark Ready for ADEK Evaluation</button>
              <button className="btn secondary" name="action" value="coordinator_return">Return for Correction</button>
            </div>
          </form>
        </div>
      )}

      {user.role === "evaluator" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>ADEK Evaluation Rubric</h2>
          <form action="/api/workflow" method="post" className="grid">
            {baseHidden}
            {yesNoSelect("cultural_authenticity", "A. Cultural Authenticity", "Accurate, respectful, and meaningful representation of UAE identity, heritage, values, and cultural elements.")}
            {yesNoSelect("artistic_excellence", "B. Artistic Excellence (Quality)", "Creative, well-crafted, visually compelling, and suitable for professional public display.")}
            {yesNoSelect("ethical_public_appropriateness", "C. Ethical & Public Appropriateness", "Respectful, inclusive, age-appropriate, and aligned with educational, social, and community values.")}
            <div className="card" style={{ boxShadow: "none" }}>
              <strong>Automatic decision model</strong>
              <p className="muted small">All 3 Yes = Approved. All 3 No = Disqualified. A and/or B Yes but C No = Disqualified. A and/or C Yes but B No = Needs Review. B and/or C Yes but A No = Needs Review.</p>
            </div>
            <textarea className="input" name="comment" placeholder="Evaluator comments" />
            <button className="btn" name="action" value="submit_evaluation">Submit Evaluation</button>
          </form>
        </div>
      )}

      {user.role === "management" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Management Final Decision</h2>
          <form action="/api/workflow" method="post" className="grid">
            {baseHidden}
            <textarea className="input" name="comment" placeholder="Management reason / decision notes" required />
            <div className="actions">
              <button className="btn" name="action" value="management_approve">Final Approve / Select for Proofreading</button>
              <button className="btn secondary" name="action" value="management_disqualify">Final Disqualify</button>
              <button className="btn secondary" name="action" value="management_return">Return to ADEK Evaluation</button>
            </div>
          </form>
        </div>
      )}

      {user.role === "proofreader" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Proofreading Checklist</h2>
          <form action="/api/workflow" method="post" className="grid">
            {baseHidden}
            <label><input type="checkbox" name="arabic_title_reviewed" value="true" /> Arabic title reviewed</label>
            <label><input type="checkbox" name="english_title_reviewed" value="true" /> English title reviewed</label>
            <label><input type="checkbox" name="arabic_description_reviewed" value="true" /> Arabic description reviewed</label>
            <label><input type="checkbox" name="english_description_reviewed" value="true" /> English description reviewed</label>
            <textarea className="input" name="comment" placeholder="Proofreading notes" />
            <button className="btn" name="action" value="proofreading_done">Mark Proofreading Done</button>
          </form>
        </div>
      )}

      {user.role === "reviewer" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Final Review</h2>
          <form action="/api/workflow" method="post" className="grid">
            {baseHidden}
            <textarea className="input" name="comment" placeholder="Final review notes" />
            <div className="actions">
              <button className="btn" name="action" value="review_complete">Mark Completed</button>
              <button className="btn secondary" name="action" value="review_return">Return to Proofreading</button>
            </div>
          </form>
        </div>
      )}

      {user.role === "admin" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Admin View</h2>
          <p className="muted">Admins can view all submission details here. Operational actions are completed from the role workspaces.</p>
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Evaluation History</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Evaluator</th><th>Cultural</th><th>Artistic</th><th>Ethical</th><th>Decision</th><th>Date</th></tr></thead>
              <tbody>
                {(evaluations ?? []).map((e: any) => <tr key={e.id}><td>{e.profiles?.full_name}</td><td>{e.cultural_authenticity}</td><td>{e.artistic_excellence}</td><td>{e.ethical_public_appropriateness}</td><td>{decisionLabel(e.decision)}</td><td>{new Date(e.created_at).toLocaleString()}</td></tr>)}
                {(!evaluations || evaluations.length === 0) && <tr><td colSpan={6}>No evaluations yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Stage Records</h2>
          <p><strong>Management:</strong> {managementReviews?.[0] ? `${decisionLabel(managementReviews[0].decision)} - ${managementReviews[0].reason}` : "No management decision yet."}</p>
          <p><strong>Proofreading:</strong> {proofreading ? proofreading.status : "No proofreading record yet."}</p>
          <p><strong>Final Review:</strong> {finalReviews ? finalReviews.status : "No final review record yet."}</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Comments</h2>
        <div className="grid">
          {(comments ?? []).map((c: any) => <div className="card" style={{ boxShadow: "none" }} key={`${c.created_at}-${c.comment_text}`}><strong>{c.profiles?.full_name ?? "User"}</strong><span className="muted small"> — {c.profiles?.role} — {new Date(c.created_at).toLocaleString()}</span><p>{c.comment_text}</p></div>)}
          {(!comments || comments.length === 0) && <p className="muted">No comments yet.</p>}
        </div>
      </div>

      {rawDataTable(s.raw_data)}
    </main>
  );
}
