"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const MIN_VISIBLE_MS = 250;

function isPlainLeftClick(event: MouseEvent) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function shouldIgnoreLink(link: HTMLAnchorElement) {
  const href = link.getAttribute("href") ?? "";

  if (!href) return true;
  if (href.startsWith("#")) return true;
  if (href.startsWith("mailto:")) return true;
  if (href.startsWith("tel:")) return true;
  if (href.startsWith("javascript:")) return true;
  if (link.target && link.target !== "_self") return true;
  if (link.hasAttribute("download")) return true;
  if (link.getAttribute("aria-disabled") === "true") return true;
  if (link.dataset.noGlobalLoading === "true") return true;

  try {
    const url = new URL(href, window.location.href);

    if (url.origin !== window.location.origin) return true;

    if (
      url.pathname === window.location.pathname &&
      url.search === window.location.search
    ) {
      return true;
    }
  } catch {
    return true;
  }

  return false;
}

function shouldIgnoreForm(form: HTMLFormElement) {
  const target = form.getAttribute("target");

  if (target && target !== "_self") return true;

  if (form.dataset.noGlobalLoading === "true") return true;

  const action = form.getAttribute("action") ?? "";

  if (action.includes("/api/import")) return true;
  if (action.includes("/admin/import")) return true;
  if (action.includes("/api/admin/users/bulk-import")) return true;
  if (action.includes("/api/submissions/updated-artwork")) return true;
  if (action.includes("/api/admin/export/google-drive")) return true;
  if (action.includes("/api/export/google-drive")) return true;

  const enctype = form.getAttribute("enctype") ?? form.enctype ?? "";

  if (enctype.toLowerCase().includes("multipart/form-data")) return true;

  return false;
}

export function GlobalLoading() {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(false);
  const startedAtRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showLoading() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    startedAtRef.current = Date.now();
    setIsLoading(true);
  }

  function hideLoading() {
    const elapsed = Date.now() - startedAtRef.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      timeoutRef.current = null;
    }, remaining);
  }

  useEffect(() => {
    hideLoading();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!isPlainLeftClick(event)) return;

      const target = event.target as HTMLElement | null;
      const link = target?.closest?.("a") as HTMLAnchorElement | null;

      if (!link || shouldIgnoreLink(link)) return;

      showLoading();
    }

    function onSubmit(event: SubmitEvent) {
      const form = event.target as HTMLFormElement | null;
      if (!form) return;

      if (shouldIgnoreForm(form)) return;

      showLoading();
    }

    function onPageShow() {
      hideLoading();
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pageshow", onPageShow);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isLoading) return null;

  return (
    <div className="global-loading-backdrop" role="status" aria-live="polite">
      <div className="global-loading-card">
        <div className="global-loading-spinner" />
        <strong>Loading</strong>
        <span>Please wait while the system updates.</span>
      </div>
    </div>
  );
}