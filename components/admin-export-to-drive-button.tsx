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
    error: `Server returned non-JSON response. Status: ${res.status}. Response preview: ${text.slice(0, 500)}`,
  };
}

async function postExportStep(action: string, formData?: FormData) {
  const response = await fetch(`/api/admin/export/google-drive?action=${action}`, {
    method: "POST",
    headers: formData ? undefined : { "Content-Type": "application/json" },
    body: formData ?? "{}",
  });

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
}: {
  batchId: string;
  folderId: string;
  dateLabel: string;
}) {
  const formData = new FormData();
  formData.append("batch_id", batchId);
  formData.append("folder_id", folderId);
  formData.append("date_label", dateLabel);
  return formData;
}

export function AdminExportToDriveButton() {
  const router = useRouter();

  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [folderLink, setFolderLink] = useState<string | null>(null);

  async function runStep(
    label: string,
    action: string,
    formData?: FormData
  ) {
    setMessage(label);

    try {
      return await postExportStep(action, formData);
    } catch (error: any) {
      throw new Error(`${label} failed. ${error?.message ?? ""}`.trim());
    }
  }

  async function handleExport() {
    try {
      setIsExporting(true);
      setFolderLink(null);
      setMessage("Creating export folder...");

      const start = await runStep("Creating export folder", "start");
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
        buildStepForm({ batchId, folderId, dateLabel })
      );

      await runStep(
        "Building and uploading Activity Log workbook",
        "activity",
        buildStepForm({ batchId, folderId, dateLabel })
      );

      await runStep(
        "Building and uploading Submissions workbooks",
        "submissions",
        buildStepForm({ batchId, folderId, dateLabel })
      );

      await runStep(
        "Writing export summary",
        "summary",
        buildStepForm({ batchId, folderId, dateLabel })
      );

      setMessage("Export completed successfully.");
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
      <button
        className="btn"
        type="button"
        onClick={handleExport}
        disabled={isExporting}
      >
        {isExporting
          ? "Exporting..."
          : "Export Current Data to Google Shared Drive"}
      </button>

      {folderLink && (
        <a
          className="btn secondary"
          href={folderLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 10 }}
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
  );
}
