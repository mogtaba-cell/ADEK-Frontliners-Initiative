"use client";

import { useState } from "react";

export function DownloadPdfButton() {
  const [password, setPassword] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState("");

  async function downloadPdf() {
    const pdfPassword = password.trim();

    if (!pdfPassword) {
      setMessage("Enter the Analytics PDF password first.");
      return;
    }

    try {
      setIsGenerating(true);
      setMessage("Preparing Analytics PDF...");

      const query = window.location.search || "";
      const response = await fetch(`/api/analytics/pdf${query}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          "x-analytics-pdf-password": pdfPassword,
        },
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const data = await response.json();
          throw new Error(data.error || "Failed to download Analytics PDF.");
        }

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

      setPassword("");
      setMessage("Analytics PDF downloaded.");
    } catch (error: any) {
      console.error("Analytics PDF download failed:", error);
      setMessage(error.message ?? "Failed to download Analytics PDF.");
      alert(error.message ?? "Failed to download Analytics PDF.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="no-print" style={{ minWidth: 260 }}>
      <label>
        <span className="small">Analytics PDF password</span>
        <input
          className="input"
          type="password"
          value={password}
          placeholder="Enter password to unlock PDF"
          onChange={(event) => {
            setPassword(event.target.value);
            setMessage("");
          }}
          disabled={isGenerating}
        />
      </label>

      {password.trim().length > 0 && (
        <button
          className="btn secondary"
          type="button"
          onClick={downloadPdf}
          disabled={isGenerating}
          style={{ marginTop: 10 }}
        >
          {isGenerating ? "Preparing PDF..." : "Download Analytics PDF"}
        </button>
      )}

      {message && (
        <p className="muted small" style={{ marginTop: 8 }}>
          {message}
        </p>
      )}
    </div>
  );
}