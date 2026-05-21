"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

type ExportResponse = {
  ok: boolean;
  error?: string;
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function waitForIframeLoad(iframe: HTMLIFrameElement) {
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Analytics page took too long to load."));
    }, 30000);

    iframe.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };

    iframe.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Analytics page failed to load."));
    };
  });
}

async function createExactAnalyticsDashboardPdf() {
  const iframe = document.createElement("iframe");

  iframe.src = "/analytics?export_pdf=1";
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "1440px";
  iframe.style.height = "2400px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.setAttribute("aria-hidden", "true");

  document.body.appendChild(iframe);

  try {
    await waitForIframeLoad(iframe);
    await wait(1200);

    const iframeWindow = iframe.contentWindow;
    const iframeDocument = iframe.contentDocument;

    if (!iframeWindow || !iframeDocument) {
      throw new Error("Could not access analytics page for PDF export.");
    }

    if (iframeWindow.location.pathname.includes("/login")) {
      throw new Error(
        "Analytics page could not be captured because the session is not authenticated."
      );
    }

    await iframeDocument.fonts?.ready;

    const html = iframeDocument.documentElement;
    const body = iframeDocument.body;

    const width = Math.max(
      html.scrollWidth,
      body.scrollWidth,
      html.clientWidth,
      1440
    );

    const height = Math.max(
      html.scrollHeight,
      body.scrollHeight,
      html.clientHeight,
      1200
    );

    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;

    await wait(500);

    const canvas = await html2canvas(body, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: width,
      windowHeight: height,
      width,
      height,
      scrollX: 0,
      scrollY: 0,
    });

    const imgData = canvas.toDataURL("image/png", 1.0);

    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let position = 0;
    let heightLeft = imgHeight;

    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    return pdf.output("blob");
  } finally {
    iframe.remove();
  }
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

  async function handleExport() {
    try {
      setIsExporting(true);
      setFolderLink(null);
      setMessage("Creating export folder...");

      const start = await postExportStep("start");
      const batchId = start.batchId;
      const folderId = start.folder?.id;
      const dateLabel = start.dateLabel;

      if (!batchId || !folderId || !dateLabel) {
        throw new Error("Export start did not return batch/folder details.");
      }

      setFolderLink(start.folder?.webViewLink ?? null);

      setMessage("Capturing the Analytics Dashboard as PDF...");
      const analyticsPdfBlob = await createExactAnalyticsDashboardPdf();

      setMessage("Uploading Analytics Dashboard PDF...");
      const analyticsForm = buildStepForm({ batchId, folderId, dateLabel });
      analyticsForm.append(
        "analytics_pdf",
        analyticsPdfBlob,
        `Analytics Dashboard - ${new Date().toISOString().slice(0, 10)}.pdf`
      );
      await postExportStep("analytics", analyticsForm);

      setMessage("Building and uploading Activity Log workbook...");
      await postExportStep(
        "activity",
        buildStepForm({ batchId, folderId, dateLabel })
      );

      setMessage("Building and uploading Submissions workbooks. This can take a minute...");
      await postExportStep(
        "submissions",
        buildStepForm({ batchId, folderId, dateLabel })
      );

      setMessage("Writing export summary...");
      await postExportStep(
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
