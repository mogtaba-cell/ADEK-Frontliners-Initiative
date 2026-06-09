"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type KpiData = {
  totalSubmissions: number;
  adekEvaluated: number;
  completedAdekEvaluations: number;
  adekRemaining: number;
  actionableAdekRemaining: number;
  heldUnassignedAdek: number;
  totalSelected: number;
  needsManagementReview: number;
  totalDisqualified: number;
  activeCoordinatorCorrections: number;
  generalProofread: number;
  literaryProofread: number;
  finalReady: number;
  totalClosed: number;
  activeAssignments: number;
};

const emptyKpis: KpiData = {
  totalSubmissions: 0,
  adekEvaluated: 0,
  completedAdekEvaluations: 0,
  adekRemaining: 0,
  actionableAdekRemaining: 0,
  heldUnassignedAdek: 0,
  totalSelected: 0,
  needsManagementReview: 0,
  totalDisqualified: 0,
  activeCoordinatorCorrections: 0,
  generalProofread: 0,
  literaryProofread: 0,
  finalReady: 0,
  totalClosed: 0,
  activeAssignments: 0,
};

function numberFrom(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeKpis(payload: any): KpiData {
  const data = payload?.data ?? payload ?? {};
  const adekEvaluated = numberFrom(data.adekEvaluated ?? data.completedAdekEvaluations);

  return {
    totalSubmissions: numberFrom(data.totalSubmissions),
    adekEvaluated,
    completedAdekEvaluations: adekEvaluated,
    adekRemaining: numberFrom(data.adekRemaining),
    actionableAdekRemaining: numberFrom(data.actionableAdekRemaining),
    heldUnassignedAdek: numberFrom(data.heldUnassignedAdek),
    totalSelected: numberFrom(data.totalSelected),
    needsManagementReview: numberFrom(data.needsManagementReview),
    totalDisqualified: numberFrom(data.totalDisqualified),
    activeCoordinatorCorrections: numberFrom(data.activeCoordinatorCorrections),
    generalProofread: numberFrom(data.generalProofread),
    literaryProofread: numberFrom(data.literaryProofread),
    finalReady: numberFrom(data.finalReady),
    totalClosed: numberFrom(data.totalClosed),
    activeAssignments: numberFrom(data.activeAssignments),
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
    { label: "ADEK Evaluated", value: kpis.adekEvaluated },
    { label: "ADEK Remaining", value: kpis.adekRemaining },
    { label: "Actionable ADEK", value: kpis.actionableAdekRemaining },
    { label: "Held Unassigned", value: kpis.heldUnassignedAdek },
    { label: "Needs Mgmt", value: kpis.needsManagementReview },
    { label: "Corrections", value: kpis.activeCoordinatorCorrections },
    { label: "General Proofread", value: kpis.generalProofread },
    { label: "Literary Proofread", value: kpis.literaryProofread },
    { label: "Closed", value: kpis.totalClosed },
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
