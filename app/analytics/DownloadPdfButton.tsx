"use client";

import { useState } from "react";

export function DownloadPdfButton() {
  const [isGenerating, setIsGenerating] = useState(false);

  async function downloadPdf() {
    try {
      setIsGenerating(true);

      const query = window.location.search || "";
      const response = await fetch(`/api/analytics/pdf${query}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to download Analytics PDF.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `adek-frontliners-analytics-${new Date()
        .toISOString()
        .slice(0, 10)}.pdf`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error("Analytics PDF download failed:", error);
      alert(error.message ?? "Failed to download Analytics PDF.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <button
      className="btn secondary no-print"
      type="button"
      onClick={downloadPdf}
      disabled={isGenerating}
    >
      {isGenerating ? "Preparing PDF..." : "Download Analytics PDF"}
    </button>
  );
}