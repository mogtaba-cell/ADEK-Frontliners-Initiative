"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type KpiData = {
  totalSubmissions: number;
  totalEvaluated: number;
  totalSelected: number;
  totalProofread: number;
  totalReviewed: number;
  totalReady: number;
};

const emptyKpis: KpiData = {
  totalSubmissions: 0,
  totalEvaluated: 0,
  totalSelected: 0,
  totalProofread: 0,
  totalReviewed: 0,
  totalReady: 0,
};

function numberFrom(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeKpis(payload: any): KpiData {
  const data = payload?.data ?? payload ?? {};

  return {
    totalSubmissions: numberFrom(
      data.totalSubmissions ?? data.total_submissions ?? data.submissions
    ),
    totalEvaluated: numberFrom(
      data.totalEvaluated ?? data.total_evaluated ?? data.evaluated
    ),
    totalSelected: numberFrom(
      data.totalSelected ?? data.total_selected ?? data.selected
    ),
    totalProofread: numberFrom(
      data.totalProofread ?? data.total_proofread ?? data.proofread
    ),
    totalReviewed: numberFrom(
      data.totalReviewed ?? data.total_reviewed ?? data.reviewed
    ),
    totalReady: numberFrom(data.totalReady ?? data.total_ready ?? data.ready),
  };
}

export function KpiHeader() {
  const pathname = usePathname();
  const [kpis, setKpis] = useState<KpiData>(emptyKpis);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadKpis() {
      try {
        const response = await fetch(`/api/kpis?t=${Date.now()}`, {
          cache: "no-store",
        });

        const payload = await response.json();

        if (!cancelled) {
          setKpis(normalizeKpis(payload));
        }
      } catch (error) {
        console.error("KPI header failed to load:", error);

        if (!cancelled) {
          setKpis(emptyKpis);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadKpis();

    const interval = window.setInterval(loadKpis, 30000);

    function onFocus() {
      loadKpis();
    }

    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  const cards = [
    { label: "Total Submissions", value: kpis.totalSubmissions },
    { label: "Total Evaluated", value: kpis.totalEvaluated },
    { label: "Total Selected", value: kpis.totalSelected },
    { label: "Total Proofread", value: kpis.totalProofread },
    { label: "Total Reviewed", value: kpis.totalReviewed },
    { label: "Total Ready", value: kpis.totalReady },
  ];

  return (
    <div className="brand-header-kpis">
      <div className="header-kpis centered">
        {cards.map((card) => (
          <div className="header-kpi" key={card.label}>
            <span>{card.label}</span>
            <strong>{isLoading ? "…" : card.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}