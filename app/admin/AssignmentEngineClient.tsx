"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AssignmentBatchStatus = {
  id: string;
  phase: string;
  status: string;
  current_step: string | null;
  eligible_count: number;
  processed_count: number;
  assigned_count: number;
  skipped_count: number;
  error_count: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  recent_errors?: { reference_id: string | null; error_message: string | null; created_at: string }[];
};

const phases = [
  { phase: "coordinator_check", label: "Auto Assign Coordinator Work", description: "Assigns submitted artworks with Coordinator Pending status to active coordinators." },
  { phase: "adek_evaluation", label: "Auto Assign ADEK Evaluation Work", description: "Assigns artworks marked Ready for ADEK Evaluation to active ADEK evaluators." },
  { phase: "management_review", label: "Auto Assign Management Review Work", description: "Assigns Needs Review artworks to active management users." },
  { phase: "proofreading", label: "Auto Assign Proofreading Work", description: "Assigns selected approved artworks to active proofreaders." },
  { phase: "final_review", label: "Auto Assign Review Work", description: "Assigns proofreading-completed artworks to active reviewers." },
  { phase: "categorization", label: "Auto Assign Categorization Work", description: "Assigns review-completed artworks to active categorizers." },
  { phase: "artistic_ranking", label: "Auto Assign Artistic Grading Work", description: "Assigns categorized artworks to active raters." },
  { phase: "literary_subcategorization", label: "Auto Assign Literary Subcategory Work", description: "Assigns graded Literary Expressions artworks to active literary subcategorizers." },
];

async function readResponse(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await res.json();
  const text = await res.text();
  return { error: `Server returned non-JSON response. Status: ${res.status}. Response preview: ${text.slice(0, 500)}` };
}

export function AssignmentEngineClient() {
  const [loadingPhase, setLoadingPhase] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<AssignmentBatchStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);

  const progressPercent = useMemo(() => {
    if (!status?.eligible_count) return 0;
    return Math.min(100, Math.round((status.processed_count / status.eligible_count) * 100));
  }, [status]);

  const isRunning = loadingPhase !== null || status?.status === "queued" || status?.status === "processing";

  async function runAssignment(phase: string) {
    setLoadingPhase(phase);
    setBatchId(null);
    setStatus(null);
    setMessage("Starting assignment...");
    setStartError(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, limit: 500 }),
        signal: controller.signal,
      });

      window.clearTimeout(timeout);
      const data = await readResponse(res);

      if (!res.ok) {
        setStartError(data.error || "Assignment failed to start.");
        setMessage(null);
        setLoadingPhase(null);
        return;
      }

      if (!data.batchId) {
        setStartError("Assignment API did not return a batchId.");
        setMessage(null);
        setLoadingPhase(null);
        return;
      }

      setBatchId(data.batchId);
      setMessage("Assignment started. Reading progress...");
      setLoadingPhase(null);
    } catch (error: any) {
      window.clearTimeout(timeout);
      setStartError(error?.name === "AbortError" ? "Assignment start request timed out after 15 seconds. Check the terminal/server logs." : error?.message || "Assignment failed to start.");
      setMessage(null);
      setLoadingPhase(null);
    }
  }

  useEffect(() => {
    if (!batchId) return;

    async function poll() {
      try {
        const res = await fetch(`/api/admin/assignments?batchId=${batchId}`, { cache: "no-store" });
        const data = await readResponse(res);

        if (!res.ok) {
          setStartError(data.error || "Failed to read assignment progress.");
          return;
        }

        setStatus(data);

        if (data.status === "completed") {
          setMessage("Assignment completed.");
          if (pollingRef.current) window.clearInterval(pollingRef.current);
        }

        if (data.status === "failed") {
          setMessage(data.error_message || "Assignment failed.");
          if (pollingRef.current) window.clearInterval(pollingRef.current);
        }
      } catch (error: any) {
        setStartError(error?.message || "Failed to read assignment progress.");
      }
    }

    poll();
    pollingRef.current = window.setInterval(poll, 1000);

    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, [batchId]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Assignment Engine</h2>
      <p className="muted">Use these buttons to automatically allocate eligible artworks to users without duplication. The system prevents more than one active assignment for the same artwork and phase.</p>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        {phases.map((item) => (
          <div key={item.phase} className="card" style={{ border: "1px solid rgba(28, 62, 59, 0.14)", boxShadow: "none" }}>
            <h3>{item.label}</h3>
            <p className="muted">{item.description}</p>
            <button className="btn" type="button" disabled={isRunning} onClick={() => runAssignment(item.phase)}>
              {loadingPhase === item.phase ? "Starting..." : item.label}
            </button>
          </div>
        ))}
      </div>

      {message && <p className="muted" style={{ marginTop: 16 }}>{message}</p>}

      {startError && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 16, background: "#fff1f1", border: "1px solid #d88", whiteSpace: "pre-wrap" }}>
          <strong>Error:</strong> {startError}
        </div>
      )}

      {status && (
        <div style={{ marginTop: 20, border: "1px solid rgba(28, 62, 59, 0.18)", borderRadius: 16, padding: 16, background: "#fff" }}>
          <h2 style={{ marginTop: 0 }}>Live Assignment Progress</h2>
          <p className="muted" style={{ marginBottom: 8 }}>Phase: <strong>{status.phase}</strong></p>
          <p className="muted" style={{ marginBottom: 8 }}>Status: <strong>{status.status}</strong></p>
          <p className="muted" style={{ marginBottom: 16 }}>Current step: <strong>{status.current_step || "Preparing assignment..."}</strong></p>

          <div style={{ height: 18, width: "100%", background: "#EBE6DF", borderRadius: 999, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ height: "100%", width: `${progressPercent}%`, background: "#1C3E3B", transition: "width 0.3s ease" }} />
          </div>
          <p className="muted" style={{ marginTop: 0 }}>{progressPercent}% complete</p>

          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div className="card"><strong>Eligible Artworks</strong><p>{status.eligible_count}</p></div>
            <div className="card"><strong>Processed</strong><p>{status.processed_count}</p></div>
            <div className="card"><strong>Assigned</strong><p>{status.assigned_count}</p></div>
            <div className="card"><strong>Skipped</strong><p>{status.skipped_count}</p></div>
            <div className="card"><strong>Errors</strong><p>{status.error_count}</p></div>
            <div className="card"><strong>Batch ID</strong><p style={{ fontSize: 12, wordBreak: "break-all" }}>{status.id}</p></div>
          </div>

          {status.error_message && <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "#fff1f1", border: "1px solid #d88" }}><strong>Error:</strong> {status.error_message}</div>}

          {status.recent_errors && status.recent_errors.length > 0 && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "#fff8ec", border: "1px solid rgba(28, 62, 59, 0.18)" }}>
              <strong>Recent assignment errors</strong>
              <ul>
                {status.recent_errors.map((item, index) => <li key={`${item.reference_id}-${index}`}>{item.reference_id || "Unknown reference"}: {item.error_message}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
