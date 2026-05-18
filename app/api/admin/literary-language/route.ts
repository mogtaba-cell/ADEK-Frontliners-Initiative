import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectBack(req: Request, params: Record<string, string>) {
  const page = params.page;
  const url = new URL("/admin/literary-language", req.url);

  for (const [key, value] of Object.entries(params)) {
    if (key === "page") continue;
    url.searchParams.set(key, value);
  }

  if (page) {
    url.searchParams.set("page", page);
  }

  return NextResponse.redirect(url, {
    status: 303,
  });
}

export async function POST(req: Request) {
  let page = "1";

  try {
    const user = await requireUser(["admin"]);
    const form = await req.formData();

    const submissionId = String(form.get("submission_id") ?? "");
    const literaryLanguage = String(form.get("literary_language") ?? "");
    page = String(form.get("page") ?? "1");

    if (!submissionId) throw new Error("Missing submission ID.");

    if (!["arabic", "english_or_others"].includes(literaryLanguage)) {
      throw new Error("Invalid literary language.");
    }

    const { data: before } = await supabaseAdmin
      .from("submissions")
      .select("id,reference_id,literary_language")
      .eq("id", submissionId)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("submissions")
      .update({
        literary_language: literaryLanguage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    if (error) {
      throw new Error(`Could not update literary language: ${error.message}`);
    }

    await audit({
      actorId: user.id,
      action: "literary_language_classified",
      entityType: "submission",
      entityId: submissionId,
      before,
      after: {
        literary_language: literaryLanguage,
      },
    });

    return redirectBack(req, {
      saved: "1",
      page,
    });
  } catch (error: any) {
    console.error("Literary language update failed:", error);

    return redirectBack(req, {
      error: error.message ?? "Could not update literary language.",
      page,
    });
  }
}