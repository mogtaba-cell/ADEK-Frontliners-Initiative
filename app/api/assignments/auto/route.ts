import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { autoAssignPending } from "@/lib/assignment";
import type { WorkflowPhase } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const repairPhases: WorkflowPhase[] = [
  "adek_evaluation",
  "management_review",
  "proofreading",
  "literary_proofreading",
  "final_review",
];

function redirectBack(req: Request, params: Record<string, string>) {
  const url = new URL("/admin", req.url);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url, {
    status: 303,
  });
}

async function readPayload(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return {
      payload: await req.json(),
      wantsJson: true,
    };
  }

  const form = await req.formData();

  return {
    payload: {
      phase: String(form.get("phase") ?? ""),
      limit: Number(form.get("limit") ?? 250),
    },
    wantsJson: false,
  };
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(["admin"]);
    const { payload, wantsJson } = await readPayload(req);

    const phase = String(payload.phase ?? "");
    const limit = Number(payload.limit ?? 250);

    if (!phase) {
      throw new Error("Missing assignment phase.");
    }

    if (phase === "repair_missing") {
      const results = await Promise.all(
        repairPhases.map(async (repairPhase) => {
          try {
            const result = await autoAssignPending(repairPhase, limit, user.id);

            return {
              phase: repairPhase,
              ok: true,
              result,
            };
          } catch (error: any) {
            return {
              phase: repairPhase,
              ok: false,
              error: error.message ?? "Repair failed.",
            };
          }
        })
      );

      const failed = results.filter((result) => !result.ok);

      if (wantsJson) {
        return NextResponse.json({
          ok: failed.length === 0,
          mode: "repair_missing",
          results,
        });
      }

      return redirectBack(req, {
        maintenance: failed.length ? "repair_partial" : "repair_completed",
      });
    }

    const result = await autoAssignPending(
      phase as WorkflowPhase,
      Number.isFinite(limit) ? limit : 250,
      user.id
    );

    if (wantsJson) {
      return NextResponse.json({
        ok: true,
        phase,
        result,
      });
    }

    return redirectBack(req, {
      maintenance: "assigned",
      phase,
    });
  } catch (error: any) {
    console.error("Auto assignment failed:", error);

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message ?? "Auto assignment failed.",
        },
        {
          status:
            error.message === "FORBIDDEN" ||
            error.message === "UNAUTHENTICATED"
              ? 403
              : 500,
        }
      );
    }

    return redirectBack(req, {
      maintenance_error: error.message ?? "Auto assignment failed.",
    });
  }
}