"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ImportStatus = {
  id: string;
  file_name: string;
  status: string;
  current_step: string | null;
  rows_total: number;
  rows_processed: number;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  rows_errors: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type UserImportResult = {
  ok: boolean;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: {
    row: number;
    email?: string | null;
    message: string;
  }[];
};

async function readResponse(res: Response) {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return await res.json();
  }

  const text = await res.text();

  return {
    error: `Server returned non-JSON response. Status: ${res.status}. Response preview: ${text.slice(
      0,
      500
    )}`,
  };
}

function downloadUserTemplateCsv() {
  const csv = [
    "full_name,email,username,role,proofreader_type,temp_password,is_active",
    "Admin User,admin@example.com,admin_user,admin,,ChangeMe@2026,true",
    "ADEK HQ User,adek_hq@example.com,adek_hq_user,adek_hq,,ChangeMe@2026,true",
    "ADEK Evaluator 1,adek_evaluator_1@example.com,adek_evaluator_1,evaluator,,ChangeMe@2026,true",
    "Coordinator 1,coordinator_1@example.com,coordinator_1,coordinator,,ChangeMe@2026,true",
    "Management 1,management_1@example.com,management_1,management,,ChangeMe@2026,true",
    "General Proofreader 1,general_proofreader_1@example.com,general_proofreader_1,proofreader,general,ChangeMe@2026,true",
    "Arabic Literary Proofreader 1,arabic_literary_1@example.com,arabic_literary_1,proofreader,literary_arabic,ChangeMe@2026,true",
    "English or Other Literary Proofreader 1,english_literary_1@example.com,english_literary_1,proofreader,literary_english_or_others,ChangeMe@2026,true",
    "Reviewer 1,reviewer_1@example.com,reviewer_1,reviewer,,ChangeMe@2026,true",
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "frontliner_users_import_template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ImportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [userFile, setUserFile] = useState<File | null>(null);
  const [isUserImporting, setIsUserImporting] = useState(false);
  const [userImportMessage, setUserImportMessage] = useState<string | null>(
    null
  );
  const [userImportError, setUserImportError] = useState<string | null>(null);
  const [userImportResult, setUserImportResult] =
    useState<UserImportResult | null>(null);

  const pollingRef = useRef<number | null>(null);

  const progressPercent = useMemo(() => {
    if (!status?.rows_total) return 0;

    return Math.min(
      100,
      Math.round((status.rows_processed / status.rows_total) * 100)
    );
  }, [status]);

  const isRunning =
    status?.status === "queued" ||
    status?.status === "processing" ||
    isUploading;

  async function startImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Please choose a submissions file first.");
      return;
    }

    setIsUploading(true);
    setMessage("Uploading submissions file...");
    setError(null);
    setStatus(null);
    setBatchId(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/import", {
      method: "POST",
      body: formData,
    });

    const data = await readResponse(res);

    if (!res.ok) {
      setIsUploading(false);
      setMessage(null);
      setError(data.error || "Import failed to start.");
      return;
    }

    setBatchId(data.batchId);
    setMessage("Submission import started. Reading progress...");
    setIsUploading(false);
  }

  async function startUserImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!userFile) {
      setUserImportError("Please choose a users file first.");
      return;
    }

    setIsUserImporting(true);
    setUserImportMessage("Uploading users file...");
    setUserImportError(null);
    setUserImportResult(null);

    const formData = new FormData();
    formData.append("file", userFile);

    const res = await fetch("/api/admin/users/bulk-import", {
      method: "POST",
      body: formData,
    });

    const data = await readResponse(res);

    if (!res.ok) {
      setIsUserImporting(false);
      setUserImportMessage(null);
      setUserImportError(data.error || "Bulk user import failed.");
      return;
    }

    setUserImportResult(data);
    setUserImportMessage("Bulk user import completed.");
    setIsUserImporting(false);
  }

  useEffect(() => {
    if (!batchId) return;

    async function poll() {
      const res = await fetch(`/api/import?batchId=${batchId}`, {
        cache: "no-store",
      });

      const data = await readResponse(res);

      if (!res.ok) {
        setError(data.error || "Failed to read import progress.");
        return;
      }

      setStatus(data);

      if (data.status === "completed") {
        setMessage("Submission import completed successfully.");

        if (pollingRef.current) {
          window.clearInterval(pollingRef.current);
        }
      }

      if (data.status === "failed") {
        setError(data.error_message || "Submission import failed.");

        if (pollingRef.current) {
          window.clearInterval(pollingRef.current);
        }
      }
    }

    poll();
    pollingRef.current = window.setInterval(poll, 1000);

    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, [batchId]);

  return (
    <div className="grid" style={{ marginTop: 16 }}>
      <div className="card">
        <h2>Import Submissions</h2>

        <p className="muted">
          Upload the source submissions Excel file. Existing artworks are updated
          by referenceId and never duplicated.
        </p>

        <div style={{ marginBottom: 16, marginTop: 16 }}>
          <a
            className="btn secondary"
            href="/templates/frontliner_import_sample.xlsx"
            download
          >
            Download Sample Import File
          </a>
        </div>

        <form
          onSubmit={startImport}
          className="grid"
          data-no-global-loading="true"
        >
          <input
            className="input"
            type="file"
            name="file"
            accept=".xlsx,.xls,.csv"
            required
            disabled={isRunning}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />

          <button className="btn" disabled={isRunning}>
            {isRunning ? "Import Running..." : "Import Submissions"}
          </button>
        </form>

        {message && (
          <p className="muted" style={{ marginTop: 16 }}>
            {message}
          </p>
        )}

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 16,
              background: "#fff1f1",
              border: "1px solid #d88",
              whiteSpace: "pre-wrap",
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {status && (
          <div
            style={{
              marginTop: 20,
              border: "1px solid rgba(28, 62, 59, 0.18)",
              borderRadius: 16,
              padding: 16,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Live Submission Import Progress</h2>

            <p className="muted" style={{ marginBottom: 8 }}>
              File: <strong>{status.file_name}</strong>
            </p>

            <p className="muted" style={{ marginBottom: 8 }}>
              Status: <strong>{status.status}</strong>
            </p>

            <p className="muted" style={{ marginBottom: 16 }}>
              Current step:{" "}
              <strong>{status.current_step || "Preparing..."}</strong>
            </p>

            <div
              style={{
                height: 18,
                width: "100%",
                background: "#EBE6DF",
                borderRadius: 999,
                overflow: "hidden",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progressPercent}%`,
                  background: "#1C3E3B",
                  transition: "width 0.3s ease",
                }}
              />
            </div>

            <p className="muted" style={{ marginTop: 0 }}>
              {progressPercent}% complete
            </p>

            <div className="grid grid-3" style={{ marginTop: 16 }}>
              <div className="card">
                <strong>Total Rows</strong>
                <p>{status.rows_total}</p>
              </div>

              <div className="card">
                <strong>Processed</strong>
                <p>{status.rows_processed}</p>
              </div>

              <div className="card">
                <strong>New Artworks</strong>
                <p>{status.rows_inserted}</p>
              </div>

              <div className="card">
                <strong>Updated Artworks</strong>
                <p>{status.rows_updated}</p>
              </div>

              <div className="card">
                <strong>Skipped Rows</strong>
                <p>{status.rows_skipped}</p>
              </div>

              <div className="card">
                <strong>Error Rows</strong>
                <p>{status.rows_errors}</p>
              </div>
            </div>

            {status.error_message && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 12,
                  background: "#fff1f1",
                  border: "1px solid #d88",
                }}
              >
                <strong>Error:</strong> {status.error_message}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Bulk Import Users</h2>

        <p className="muted">
          Upload an Excel or CSV file to create/update users in bulk. Existing
          users are matched by email and updated instead of duplicated.
        </p>

        <div style={{ marginBottom: 16, marginTop: 16 }} className="actions">
          <button
            className="btn secondary"
            type="button"
            onClick={downloadUserTemplateCsv}
          >
            Download Users Import Template
          </button>
        </div>

        <div
          style={{
            marginBottom: 16,
            padding: 16,
            borderRadius: 16,
            background: "rgba(178, 199, 192, 0.18)",
            border: "1px solid rgba(28, 62, 59, 0.18)",
          }}
        >
          <strong>Required columns:</strong>
          <p className="muted small" style={{ marginBottom: 0 }}>
            full_name, email, username, role, proofreader_type, temp_password,
            is_active
          </p>

          <p className="muted small">
            Allowed roles: admin, coordinator, evaluator, management,
            proofreader, reviewer, adek_hq. For proofreaders use
            proofreader_type: general, literary_arabic, or
            literary_english_or_others.
          </p>
        </div>

        <form
          onSubmit={startUserImport}
          className="grid"
          data-no-global-loading="true"
        >
          <input
            className="input"
            type="file"
            name="file"
            accept=".xlsx,.xls,.csv"
            required
            disabled={isUserImporting}
            onChange={(event) => setUserFile(event.target.files?.[0] ?? null)}
          />

          <button className="btn" disabled={isUserImporting}>
            {isUserImporting ? "Importing Users..." : "Bulk Import Users"}
          </button>
        </form>

        {userImportMessage && (
          <p className="muted" style={{ marginTop: 16 }}>
            {userImportMessage}
          </p>
        )}

        {userImportError && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 16,
              background: "#fff1f1",
              border: "1px solid #d88",
              whiteSpace: "pre-wrap",
            }}
          >
            <strong>Error:</strong> {userImportError}
          </div>
        )}

        {userImportResult && (
          <div
            style={{
              marginTop: 20,
              border: "1px solid rgba(28, 62, 59, 0.18)",
              borderRadius: 16,
              padding: 16,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Bulk User Import Result</h2>

            <div className="grid grid-3" style={{ marginTop: 16 }}>
              <div className="card">
                <strong>Total Rows</strong>
                <p>{userImportResult.totalRows}</p>
              </div>

              <div className="card">
                <strong>Created</strong>
                <p>{userImportResult.created}</p>
              </div>

              <div className="card">
                <strong>Updated</strong>
                <p>{userImportResult.updated}</p>
              </div>

              <div className="card">
                <strong>Skipped</strong>
                <p>{userImportResult.skipped}</p>
              </div>

              <div className="card">
                <strong>Errors</strong>
                <p>{userImportResult.errors.length}</p>
              </div>
            </div>

            {userImportResult.errors.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3>Import Errors</h3>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Email</th>
                        <th>Error</th>
                      </tr>
                    </thead>

                    <tbody>
                      {userImportResult.errors.map((item, index) => (
                        <tr key={`${item.row}-${index}`}>
                          <td>{item.row}</td>
                          <td>{item.email || "—"}</td>
                          <td>{item.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}