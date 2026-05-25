import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { AdminExportToDriveButton } from "@/components/admin-export-to-drive-button";

export const dynamic = "force-dynamic";

const UAE_TIME_ZONE = "Asia/Dubai";

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatUaeDateTime(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UAE_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function googleDriveFolderUrl(folderId: string | null | undefined) {
  if (!folderId) return null;
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export default async function ExportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(["admin"]);
  const params = (await searchParams) ?? {};

  const success = firstParam(params.success);
  const error = firstParam(params.error);

  const { data, error: exportError } = await supabaseAdmin
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
          Manual platform export is locked to protect Vercel CPU usage. Use the
          local Ready Submissions export script whenever possible. Only unlock
          this export if you intentionally need the full Google Drive export.
        </p>

        {success && (
          <p className="pill" style={{ marginTop: 12 }}>
            Export completed successfully.
          </p>
        )}

        {error && (
          <p
            className="pill"
            style={{
              marginTop: 12,
              background: "#fff1f1",
              color: "#9b2f2f",
            }}
          >
            Export failed: {error}
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          <AdminExportToDriveButton />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Recent Exports</h2>

        <p className="muted small" style={{ marginTop: -6 }}>
          Dates and completed times are shown in UAE time.
        </p>

        {exportError ? (
          <p className="muted">
            Could not load export history: {exportError.message}
          </p>
        ) : (
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
                {(data ?? []).map((batch: any) => {
                  const folderUrl = googleDriveFolderUrl(
                    batch.destination_folder_id
                  );

                  return (
                    <tr key={batch.id}>
                      <td>{formatUaeDateTime(batch.created_at)}</td>

                      <td>{batch.mode ?? "—"}</td>

                      <td>
                        <span className="pill">{batch.status ?? "—"}</span>
                      </td>

                      <td>{formatUaeDateTime(batch.completed_at)}</td>

                      <td>
                        {folderUrl ? (
                          <a
                            className="btn secondary"
                            href={folderUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open Folder
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td>{batch.error_message || "—"}</td>
                    </tr>
                  );
                })}

                {(data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6}>No export history yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}