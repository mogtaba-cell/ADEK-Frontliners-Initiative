import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import ImportClient from "./ImportClient";

export default async function ImportPage() {
  const user = await requireUser(["admin"]);

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="table-title-row">
        <div>
          <h1>Import Center</h1>
          <p className="muted">
            Import submissions and bulk import system users from Excel or CSV files.
          </p>
        </div>
      </div>

      <ImportClient />
    </main>
  );
}