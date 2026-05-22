"use client";

import { useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));

  await Promise.all(
    images.map((img) => {
      if (img.complete) return Promise.resolve();

      return new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    })
  );
}

function buildFileName() {
  return `adek-frontliners-analytics-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
}

export function DownloadPdfButton() {
  const [isGenerating, setIsGenerating] = useState(false);

  async function downloadPdf() {
    const exportArea = document.querySelector(
      "[data-analytics-export-area]"
    ) as HTMLElement | null;

    if (!exportArea) {
      alert("Could not find the analytics dashboard area to export.");
      return;
    }

    const hiddenElements = Array.from(
      exportArea.querySelectorAll(".no-print")
    ) as HTMLElement[];

    const previousDisplayValues = hiddenElements.map(
      (element) => element.style.display
    );

    try {
      setIsGenerating(true);

      hiddenElements.forEach((element) => {
        element.style.display = "none";
      });

      await document.fonts?.ready;
      await waitForImages(exportArea);
      await wait(300);

      const rect = exportArea.getBoundingClientRect();

      const width = Math.max(
        Math.ceil(exportArea.scrollWidth),
        Math.ceil(rect.width),
        1200
      );

      const height = Math.max(
        Math.ceil(exportArea.scrollHeight),
        Math.ceil(rect.height),
        1200
      );

      const canvas = await html2canvas(exportArea, {
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
        scrollY: -window.scrollY,
      });

      const imageData = canvas.toDataURL("image/png", 1.0);

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imageWidth = pageWidth;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;

      let position = 0;
      let heightLeft = imageHeight;

      pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imageHeight;
        pdf.addPage();
        pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(buildFileName());
    } catch (error: any) {
      console.error("Analytics PDF download failed:", error);
      alert(error.message ?? "Failed to download Analytics PDF.");
    } finally {
      hiddenElements.forEach((element, index) => {
        element.style.display = previousDisplayValues[index] ?? "";
      });

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