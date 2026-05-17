import Link from "next/link";
import { Nav } from "@/components/nav";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function getManagementCounts(userId: string) {
  const [
    needsReviewRes,
    approvedRes,
    disqualifiedRes,
    allSubmissionsRes,
  ] = await Promise.all([
    supabaseAdmin
      .from("assignments")
      .select("id,submissions!inner(id,workflow_status)", {
        count: "exact",
        head: true,
      })
      .eq("assigned_to", userId)
      .eq("phase", "management_review")
      .in("status", ["assigned", "in_progress"])
      .eq("submissions.workflow_status", "needs_management_review"),

    supabaseAdmin
      .from("assignments")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("assigned_to", userId)
      .eq("phase", "management_review")
      .eq("status", "completed")
      .eq("decision", "approved"),

    supabaseAdmin
      .from("assignments")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("assigned_to", userId)
      .eq("phase", "management_review")
      .eq("status", "completed")
      .eq("decision", "disqualified"),

    supabaseAdmin
      .from("submissions")
      .select("id", {
        count: "exact",
        head: true,
      }),
  ]);

  return {
    needsReview: needsReviewRes.count ?? 0,
    approved: approvedRes.count ?? 0,
    disqualified: disqualifiedRes.count ?? 0,
    allSubmissions: allSubmissionsRes.count ?? 0,
  };
}

export default async function ManagementHomePage() {
  const user = await requireUser(["management", "admin"]);
  const counts = await getManagementCounts(user.id);

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="table-title-row">
        <div>
          <h1>Management</h1>
          <p className="muted">
            Review artwork cases that need Management decision, or browse all
            submissions in view-only/oversight mode.
          </p>
        </div>
      </div>

      <div className="grid grid-4 analytics-section">
        <div className="card">
          <strong>Needs Review</strong>
          <p className="stat-number">{counts.needsReview}</p>
        </div>

        <div className="card">
          <strong>Approved by Me</strong>
          <p className="stat-number">{counts.approved}</p>
        </div>

        <div className="card">
          <strong>Disqualified by Me</strong>
          <p className="stat-number">{counts.disqualified}</p>
        </div>

        <div className="card">
          <strong>All Submissions</strong>
          <p className="stat-number">{counts.allSubmissions}</p>
        </div>
      </div>

      <div className="grid grid-2 analytics-section">
        <div className="card">
          <h2>Needs Review Workspace</h2>
          <p className="muted">
            This is Management’s main task area. It includes artworks sent for
            review by ADEK Evaluators and Literary Proofreaders.
          </p>

          <div className="submission-text-block">
            <strong>Management decisions</strong>
            <div>
              Approve → artwork continues to the next required stage.
              <br />
              Disqualify → artwork is removed from the workflow.
            </div>
          </div>

          <div className="actions" style={{ marginTop: 16 }}>
            <Link className="btn" href="/management/work">
              Open Needs Review Workspace
            </Link>
          </div>
        </div>

        <div className="card">
          <h2>All Submissions</h2>
          <p className="muted">
            Browse, filter, and inspect every submission. Updated artwork files
            uploaded by Coordinators are visible here when available.
          </p>

          <div className="submission-text-block">
            <strong>Includes</strong>
            <div>
              Source files, updated files, workflow status, artwork data,
              student details, and edited titles/descriptions.
            </div>
          </div>

          <div className="actions" style={{ marginTop: 16 }}>
            <Link className="btn secondary" href="/submissions">
              Open All Submissions
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}