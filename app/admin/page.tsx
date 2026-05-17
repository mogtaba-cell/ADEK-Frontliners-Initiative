import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { AssignmentEngineClient } from "./AssignmentEngineClient";

export default async function AdminPage() {
  const user = await requireUser(["admin"]);

  const [
    submissions,
    activeAssignments,
    lastExport,
    coordinatorPending,
    readyForAdek,
    needsManagementReview,
    selectedForProofreading,
    proofreadingDone,
  ] = await Promise.all([
    supabaseAdmin.from("submissions").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("assignments").select("id", { count: "exact", head: true }).in("status", ["assigned", "in_progress"]),
    supabaseAdmin.from("export_batches").select("*").order("created_at", { ascending: false }).limit(1),
    supabaseAdmin.from("submissions").select("id", { count: "exact", head: true }).eq("workflow_status", "coordinator_pending"),
    supabaseAdmin.from("submissions").select("id", { count: "exact", head: true }).eq("workflow_status", "ready_for_adek"),
    supabaseAdmin.from("submissions").select("id", { count: "exact", head: true }).eq("workflow_status", "needs_management_review"),
    supabaseAdmin.from("submissions").select("id", { count: "exact", head: true }).eq("workflow_status", "selected_for_proofreading"),
    supabaseAdmin.from("submissions").select("id", { count: "exact", head: true }).eq("workflow_status", "proofreading_done"),
  ]);

  return (
    <main className="container">
      <Nav role={user.role} />
      <h1>Admin Dashboard</h1>

      <div className="grid grid-3">
        <div className="card"><h2>Total submissions</h2><p style={{ fontSize: 32 }}>{submissions.count ?? 0}</p></div>
        <div className="card"><h2>Active assignments</h2><p style={{ fontSize: 32 }}>{activeAssignments.count ?? 0}</p></div>
        <div className="card"><h2>Last export</h2><p>{lastExport.data?.[0]?.status ?? "No exports yet"}</p></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Eligible Work Queues</h2>
        <div className="grid grid-3">
          <div><strong>Coordinator Pending</strong><p style={{ fontSize: 28 }}>{coordinatorPending.count ?? 0}</p></div>
          <div><strong>Ready for ADEK</strong><p style={{ fontSize: 28 }}>{readyForAdek.count ?? 0}</p></div>
          <div><strong>Needs Management Review</strong><p style={{ fontSize: 28 }}>{needsManagementReview.count ?? 0}</p></div>
          <div><strong>Selected for Proofreading</strong><p style={{ fontSize: 28 }}>{selectedForProofreading.count ?? 0}</p></div>
          <div><strong>Proofreading Done</strong><p style={{ fontSize: 28 }}>{proofreadingDone.count ?? 0}</p></div>
        </div>
      </div>

      <AssignmentEngineClient />
    </main>
  );
}
