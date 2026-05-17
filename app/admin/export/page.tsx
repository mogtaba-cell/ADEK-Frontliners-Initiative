import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function driveFolderLink(folderId: string | null | undefined) {
  if (!folderId) return null;
  return `https://drive.google.com/drive/folders/${folderId}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export default async function ExportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(["admin"]);
  const params = (await searchParams) ?? {};

  const success = params.success === "1";
  const error =
    typeof params.error === "string"
      ? params.error
      : Array.isArray(params.error)
        ? params.error[0]
        : "";

  const { data } = await supabaseAdmin
    .from("export_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main className="container">
      <Nav role={user.role} />

      <div className="card">
        <h1>Export & Backup</h1>

        <p className="muted">
          Use this button to create a dated folder in Google Shared Drive and
          upload the analytics PDF, activity log, all submissions workbook, ready
          submissions workbook, and export summary.
        </p>

        {success && (
          <div className="pill" style={{ marginBottom: 14 }}>
            Export completed successfully.
          </div>
        )}

        {error && (
          <div
            className="pill"
            style={{
              marginBottom: 14,
              background: "#fff1f1",
              color: "#9b2f2f",
            }}
          >
            Export failed: {error}
          </div>
        )}

        <form action="/api/admin/export/google-drive" method="post">
          <button className="btn" type="submit">
            Export Current Data to Google Shared Drive
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Recent Exports</h2>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Completed</th>
                <th>Folder</th>
                <th>Error</th>
              </tr>
            </thead>

            <tbody>
              {data?.map((batch: any) => {
                const folderLink = driveFolderLink(batch.destination_folder_id);

                return (
                  <tr key={batch.id}>
                    <td>{formatDate(batch.created_at)}</td>
                    <td>{batch.mode ?? "manual"}</td>
                    <td>
                      <span className="pill">{batch.status ?? "unknown"}</span>
                    </td>
                    <td>{formatDate(batch.completed_at)}</td>
                    <td>
                      {folderLink ? (
                        <a
                          className="btn secondary"
                          href={folderLink}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open Folder
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{batch.error_message ?? "—"}</td>
                  </tr>
                );
              })}

              {!data?.length && (
                <tr>
                  <td colSpan={6}>No exports yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}