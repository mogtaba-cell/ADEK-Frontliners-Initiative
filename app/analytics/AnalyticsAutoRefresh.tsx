"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AnalyticsAutoRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    function refresh() {
      if (!cancelled) {
        router.refresh();
      }
    }

    const interval = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [router, intervalMs]);

  return null;
}
