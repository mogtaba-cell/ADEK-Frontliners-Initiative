"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ExportResponse = {
  ok: boolean;
  error?: string;
  action?: string;
  batchId?: string;
  dateLabel?: string;
  folder?: {
    id: string;
    name: string;
    webViewLink: string | null;
  };
  file?: {
    id: string;
    name: string;
    webViewLink: string | null;
  };
  files?: {
    id?: string;
    name?: string;
    file_name?: string;
    google_file_url?: string | null;
    webViewLink?: string | null;
  }[];
};

async function readResponse(res: Response): Promise<ExportResponse> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return (await res.json()) as ExportResponse;
  }

  const text = await res.text();

  return {
    ok: false,
    error: `Server returned non-JSON response. Status: ${res.status}. Response preview: ${text.slice(
      0,
      500
    )}`,
  };
}

async function postExportStep(action: string, formData: FormData) {
  const response = await fetch(
    `/api/admin/export/google-drive?action=${action}`,
    {
      method: "POST",
      body: formData,
    }
  );

  const result = await readResponse(response);

  if (!response.ok || !result.ok) {
    throw new Error(result.error ?? `Export step failed: ${action}`);
  }

  return result;
}

function buildStepForm({
  batchId,
  folderId,
  dateLabel,
  password,
}: {
  batchId: string;
  folderId: string;
  dateLabel: string;
  password: string;
}) {
  const formData = new FormData();
  formData.append("batch_id", batchId);
  formData.append("folder_id", folderId);
  formData.append("date_label", dateLabel);
  formData.append("export_password", password);
  return formData;
}

function buildStartForm(password: string) {
  const formData = new FormData();
  formData.append("export_password", password);
  return formData;
}

export function AdminExportToDriveButton() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [folderLink, setFolderLink] = useState<string | null>(null);

  const canAttemptExport = password.trim().length > 0 && !isExporting;

  async function runStep(
    label: string,
    action: string,
    formData: FormData
  ) {
    setMessage(label);

    try {
      return await postExportStep(action, formData);
    } catch (error: any) {
      throw new Error(`${label} failed. ${error?.message ?? ""}`.trim());
    }
  }

  async function handleExport() {
    const exportPassword = password.trim();

    if (!exportPassword) {
      setMessage("Enter the manual export password first.");
      return;
    }

    try {
      setIsExporting(true);
      setFolderLink(null);
      setMessage("Creating export folder...");

      const start = await runStep(
        "Creating export folder",
        "start",
        buildStartForm(exportPassword)
      );

      const batchId = start.batchId;
      const folderId = start.folder?.id;
      const dateLabel = start.dateLabel;

      if (!batchId || !folderId || !dateLabel) {
        throw new Error("Export start did not return batch/folder details.");
      }

      setFolderLink(start.folder?.webViewLink ?? null);

      await runStep(
        "Building and uploading Analytics Dashboard PDF",
        "analytics",
        buildStepForm({
          batchId,
          folderId,
          dateLabel,
          password: exportPassword,
        })
      );

      await runStep(
        "Building and uploading Activity Log workbook",
        "activity",
        buildStepForm({
          batchId,
          folderId,
          dateLabel,
          password: exportPassword,
        })
      );

      await runStep(
        "Building and uploading Submissions workbooks",
        "submissions",
        buildStepForm({
          batchId,
          folderId,
          dateLabel,
          password: exportPassword,
        })
      );

      await runStep(
        "Writing export summary",
        "summary",
        buildStepForm({
          batchId,
          folderId,
          dateLabel,
          password: exportPassword,
        })
      );

      setMessage("Export completed successfully.");
      setPassword("");
      router.refresh();
    } catch (error: any) {
      console.error("Export failed:", error);
      setMessage(error.message ?? "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ boxShadow: "none", padding: 14 }}>
        <label>
          <span className="small">Manual export password</span>
          <input
            className="input"
            type="password"
            value={password}
            placeholder="Enter password to unlock manual export"
            onChange={(event) => {
              setPassword(event.target.value);
              setMessage("");
            }}
            disabled={isExporting}
          />
        </label>

        <p className="muted small" style={{ marginTop: 8 }}>
          Manual export uses Vercel CPU. Use it only when the local export
          script is not enough.
        </p>

        {password.trim().length > 0 && (
          <button
            className="btn"
            type="button"
            onClick={handleExport}
            disabled={!canAttemptExport}
            style={{ marginTop: 12 }}
          >
            {isExporting
              ? "Exporting..."
              : "Export Current Data to Google Shared Drive"}
          </button>
        )}

        {folderLink && (
          <a
            className="btn secondary"
            href={folderLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: 10, marginTop: 12 }}
          >
            Open Export Folder
          </a>
        )}

        {message && (
          <p className="muted small" style={{ marginTop: 10 }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}