"use client";

import { useState } from "react";

type AssignmentResult = {
  batchId?: string;
  status?: string;
  message?: string;
  eligible_count?: number;
  assigned_count?: number;
  skipped_count?: number;
  error_count?: number;
  error?: string;
};

const phases = [
  {
    phase: "repair_missing",
    label: "Repair Missing Assignments",
    description:
      "Repairs Coordinator, Management, General Proofreading, Literary Proofreading, and Final Review tasks. It does not create ADEK evaluator assignments.",
  },
  {
    phase: "coordinator_check",
    label: "Repair Coordinator Corrections",
    description: "Assigns active returned-for-correction submissions to coordinators.",
  },
  {
    phase: "management_review",
    label: "Repair Management Review",
    description: "Assigns active needs-management-review submissions to management users.",
  },
  {
    phase: "proofreading",
    label: "Repair General Proofreading",
    description: "Assigns approved selected artworks to general proofreaders when missing.",
  },
  {
    phase: "literary_proofreading",
    label: "Repair Literary Proofreading",
    description: "Assigns approved literary artworks to the correct literary proofreader type when language is classified.",
  },
  {
    phase: "final_review",
    label: "Repair Final Review",
    description: "Assigns artworks to reviewers only after previous required stages are completed.",
  },
];

async function readResponse(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await res.json();
  const text = await res.text();
  return {
    error: `Server returned non-JSON response. Status: ${res.status}. Response preview: ${text.slice(
      0,
      500
    )}`,
  };
}

export function AssignmentEngineClient() {
  const [loadingPhase, setLoadingPhase] = useState<string | null>(null);
  const [result, setResult] = useState<AssignmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAssignment(phase: string) {
    setLoadingPhase(phase);
    setResult(null);
    setError(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90000);

    try {
      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, limit: 5000 }),
        signal: controller.signal,
      });

      window.clearTimeout(timeout);
      const data = await readResponse(res);

      if (!res.ok) {
        setError(data.error || "Assignment repair failed.");
        return;
      }

      setResult(data);
    } catch (err: any) {
      window.clearTimeout(timeout);
      setError(
        err?.name === "AbortError"
          ? "The repair request took longer than 90 seconds. Refresh the page and check the latest assignment counts before pressing again."
          : err?.message || "Assignment repair failed."
      );
    } finally {
      setLoadingPhase(null);
    }
  }

  const isRunning = loadingPhase !== null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Workflow Maintenance</h2>

      <p className="muted">
        Repair missing assignments for non-evaluator stages. ADEK evaluator assignments are intentionally excluded from repair and should be managed from the evaluator quantity assignment controls.
      </p>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        {phases.map((item) => (
          <div
            key={item.phase}
            className="card"
            style={{ border: "1px solid rgba(28, 62, 59, 0.14)", boxShadow: "none" }}
          >
            <h3>{item.label}</h3>
            <p className="muted">{item.description}</p>

            <button
              className={item.phase === "repair_missing" ? "btn" : "btn secondary"}
              type="button"
              disabled={isRunning}
              onClick={() => runAssignment(item.phase)}
            >
              {loadingPhase === item.phase ? "Working..." : item.label}
            </button>
          </div>
        ))}
      </div>

      {result && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 16,
            background: "rgba(173, 203, 195, 0.35)",
          }}
        >
          <strong>{result.message ?? "Assignment repair completed."}</strong>
          <p className="muted" style={{ marginBottom: 0 }}>
            Eligible: {result.eligible_count ?? "—"} · Assigned:{" "}
            {result.assigned_count ?? "—"} · Skipped: {result.skipped_count ?? "—"} · Errors:{" "}
            {result.error_count ?? "—"}
          </p>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 16,
            background: "#fff1f1",
            border: "1px solid rgba(155, 47, 47, 0.25)",
          }}
        >
          <strong>Repair failed</strong>
          <p className="muted" style={{ marginBottom: 0 }}>{error}</p>
        </div>
      )}
    </div>
  );
}
