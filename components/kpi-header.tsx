"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type KpiData = {
  totalSubmissions: number;
  completedAdekEvaluations: number;
  totalSelected: number;
  needsManagementReview: number;
  totalDisqualified: number;
  activeCoordinatorCorrections: number;
  generalProofread: number;
  literaryProofread: number;
  finalReady: number;
  categorized: number;
  artisticRanked: number;
  totalClosed: number;
};

const emptyKpis: KpiData = {
  totalSubmissions: 0,
  completedAdekEvaluations: 0,
  totalSelected: 0,
  needsManagementReview: 0,
  totalDisqualified: 0,
  activeCoordinatorCorrections: 0,
  generalProofread: 0,
  literaryProofread: 0,
  finalReady: 0,
  categorized: 0,
  artisticRanked: 0,
  totalClosed: 0,
};

function numberFrom(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeKpis(payload: any): KpiData {
  const data = payload?.data ?? payload ?? {};
  return {
    totalSubmissions: numberFrom(data.totalSubmissions),
    completedAdekEvaluations: numberFrom(data.completedAdekEvaluations),
    totalSelected: numberFrom(data.totalSelected),
    needsManagementReview: numberFrom(data.needsManagementReview),
    totalDisqualified: numberFrom(data.totalDisqualified),
    activeCoordinatorCorrections: numberFrom(data.activeCoordinatorCorrections),
    generalProofread: numberFrom(data.generalProofread),
    literaryProofread: numberFrom(data.literaryProofread),
    finalReady: numberFrom(data.finalReady),
    categorized: numberFrom(data.categorized),
    artisticRanked: numberFrom(data.artisticRanked),
    totalClosed: numberFrom(data.totalClosed),
  };
}

export function KpiHeader() {
  const pathname = usePathname();
  const [kpis, setKpis] = useState<KpiData>(emptyKpis);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let lastLoadedAt = 0;

    async function loadKpis(force = false) {
      const now = Date.now();

      // Avoid refetching the same global KPI payload on every tab focus.
      // This keeps active users working while reducing Supabase REST egress.
      if (!force && now - lastLoadedAt < 60_000) return;

      lastLoadedAt = now;

      try {
        const response = await fetch("/api/kpis", { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled) setKpis(normalizeKpis(payload));
      } catch (error) {
        console.error("KPI header failed to load:", error);
        if (!cancelled) setKpis(emptyKpis);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadKpis(true);
    const interval = window.setInterval(() => loadKpis(), 120000);
    const onFocus = () => loadKpis();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  const cards = [
    { label: "Total Submissions", value: kpis.totalSubmissions },
    { label: "ADEK Evaluated", value: kpis.completedAdekEvaluations },
    { label: "Total Selected", value: kpis.totalSelected },
    { label: "Needs Mgmt", value: kpis.needsManagementReview },
    { label: "Total Disqualified", value: kpis.totalDisqualified },
    { label: "Sent Corrections", value: kpis.activeCoordinatorCorrections },
    { label: "General Proofread", value: kpis.generalProofread },
    { label: "Literary Proofread", value: kpis.literaryProofread },
    { label: "Review Done", value: kpis.finalReady },
    { label: "Categorized", value: kpis.categorized },
    { label: "Final Completed", value: kpis.artisticRanked },
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
