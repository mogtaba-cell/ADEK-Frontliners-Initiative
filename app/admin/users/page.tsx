import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { UsersClient } from "./UsersClient";

const roles = [
  ["admin", "Admin"],
  ["coordinator", "Coordinator"],
  ["evaluator", "ADEK Evaluator"],
  ["management", "Management"],
  ["proofreader", "Proofreader"],
  ["reviewer", "Reviewer"],
  ["categorizer", "Categorizer"],
  ["rater", "Rater"],
  ["adek_hq", "ADEK HQ Read Only"],
];

export default async function UsersPage() {
  const user = await requireUser(["admin"]);

  const [{ data: users }, { data: links }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id,email,username,full_name,role,proofreader_type,is_active,created_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("reviewer_proofreader_links").select("reviewer_id,proofreader_id"),
  ]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="card">
        <h1>User Management</h1>
        <p className="muted">Create users, edit roles/proofreader type, and manage Reviewer to General Proofreader links in the mapping section at the bottom of this page.</p>
        <form action="/api/admin/users" method="post" className="grid grid-4">
          <input className="input" name="full_name" placeholder="Full name" required />
          <input className="input" name="email" placeholder="Email or username" required />
          <input className="input" name="username" placeholder="Username" />

          <select className="input" name="role" defaultValue="coordinator">
            {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>

          <select className="input" name="proofreader_type" defaultValue="general">
            <option value="">Proofreader type not applicable</option>
            <option value="general">General Proofreader</option>
            <option value="literary_arabic">Arabic Literary Proofreader</option>
            <option value="literary_english_or_others">English/Other Literary Proofreader</option>
          </select>

          <input className="input" name="password" placeholder="Temporary password" type="password" required />
          <button className="btn">Create user</button>
        </form>
      </div>

      <UsersClient users={users ?? []} links={links ?? []} />
    </main>
  );
}
