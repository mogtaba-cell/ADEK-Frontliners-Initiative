export type YesNoValue = string | null | undefined;

export function normalizeYesNo(value: unknown): "yes" | "no" | "" {
  const v = String(value ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(v)) return "yes";
  if (["no", "n", "false", "0"].includes(v)) return "no";
  return "";
}

export function evaluationDecision(cultural: YesNoValue, artistic: YesNoValue, ethical: YesNoValue) {
  const a = normalizeYesNo(cultural);
  const b = normalizeYesNo(artistic);
  const c = normalizeYesNo(ethical);

  if (!a || !b || !c) return "pending";

  if (a === "yes" && b === "yes" && c === "yes") return "approved";
  if (a === "no" && b === "no" && c === "no") return "disqualified";
  if (c === "no" && (a === "yes" || b === "yes")) return "disqualified";
  if (b === "no" && (a === "yes" || c === "yes")) return "needs_review";
  if (a === "no" && (b === "yes" || c === "yes")) return "needs_review";

  return "needs_review";
}

export function decisionLabel(value: string | null | undefined) {
  const v = String(value ?? "pending");
  const labels: Record<string, string> = {
    pending: "Pending",
    approved: "Approved",
    needs_review: "Needs Review",
    disqualified: "Disqualified",
  };
  return labels[v] ?? v;
}
