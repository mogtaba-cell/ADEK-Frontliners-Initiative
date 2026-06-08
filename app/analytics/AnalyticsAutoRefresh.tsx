"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AnalyticsAutoRefresh({ intervalMs = 120000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    function refresh() {
      if (!cancelled) {
        router.refresh();
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    const interval = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, intervalMs]);

  return null;
}
