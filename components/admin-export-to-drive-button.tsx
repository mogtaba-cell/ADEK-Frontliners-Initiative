"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

type ExportResponse = {
  ok: boolean;
  error?: string;
  folder?: {
    id: string;
    name: string;
    webViewLink: string | null;
  };
  files?: {
    id: string;
    name: string;
    webViewLink: string | null;
  }[];
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      throw new Error("Analytics page could not be captured because the session is not authenticated.");
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

export function AdminExportToDriveButton() {
  const router = useRouter();

  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [folderLink, setFolderLink] = useState<string | null>(null);

  async function handleExport() {
    try {
      setIsExporting(true);
      setFolderLink(null);
      setMessage("Capturing the Analytics Dashboard exactly as shown...");

      const analyticsPdfBlob = await createExactAnalyticsDashboardPdf();

      setMessage("Creating export files and uploading to Google Shared Drive...");

      const formData = new FormData();
      formData.append(
        "analytics_pdf",
        analyticsPdfBlob,
        `Analytics Dashboard - ${new Date().toISOString().slice(0, 10)}.pdf`
      );

      const response = await fetch("/api/admin/export/google-drive", {
        method: "POST",
        headers: {
          "x-requested-with": "fetch",
        },
        body: formData,
      });

      const result = (await response.json()) as ExportResponse;

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Export failed.");
      }

      setFolderLink(result.folder?.webViewLink ?? null);
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