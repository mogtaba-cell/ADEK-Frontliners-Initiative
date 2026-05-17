import { describe, expect, it } from "vitest";
import { evaluationDecision } from "../lib/decision";

describe("evaluationDecision", () => {
  it("approves when all criteria are yes", () => {
    expect(evaluationDecision("yes", "yes", "yes")).toBe("approved");
  });

  it("disqualifies when all criteria are no", () => {
    expect(evaluationDecision("no", "no", "no")).toBe("disqualified");
  });

  it("disqualifies when ethical/public appropriateness is no and A or B is yes", () => {
    expect(evaluationDecision("yes", "yes", "no")).toBe("disqualified");
    expect(evaluationDecision("yes", "no", "no")).toBe("disqualified");
    expect(evaluationDecision("no", "yes", "no")).toBe("disqualified");
  });

  it("needs review when artistic excellence is no but cultural or ethical is yes", () => {
    expect(evaluationDecision("yes", "no", "yes")).toBe("needs_review");
    expect(evaluationDecision("yes", "no", "no")).toBe("disqualified");
  });

  it("needs review when cultural authenticity is no but artistic or ethical is yes", () => {
    expect(evaluationDecision("no", "yes", "yes")).toBe("needs_review");
    expect(evaluationDecision("no", "yes", "no")).toBe("disqualified");
  });
});
