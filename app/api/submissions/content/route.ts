import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectBack(req: Request, redirectTo: string) {
  return NextResponse.redirect(new URL(redirectTo || "/submissions", req.url), {
    status: 303,
  });
}

export async function POST(req: Request) {
  try {
    const user = await requireUser([
      "admin",
      "management",
      "proofreader",
      "reviewer",
    ]);

    const form = await req.formData();

    const id = String(form.get("id") ?? "");
    const redirectTo = String(form.get("redirect_to") ?? "/submissions");

    if (!id) throw new Error("Missing submission id.");

    const updates = {
      artwork_title_en: String(form.get("artwork_title_en") ?? "").trim() || null,
      artwork_title_ar: String(form.get("artwork_title_ar") ?? "").trim() || null,
      description_en: String(form.get("description_en") ?? "").trim() || null,
      description_ar: String(form.get("description_ar") ?? "").trim() || null,
      influence_idea_source:
        String(form.get("influence_idea_source") ?? "").trim() || null,
      most_enjoyable_part:
        String(form.get("most_enjoyable_part") ?? "").trim() || null,
      focused_elements:
        String(form.get("focused_elements") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { data: before, error: beforeError } = await supabaseAdmin
      .from("submissions")
      .select(
        "id,reference_id,artwork_title_en,artwork_title_ar,description_en,description_ar,influence_idea_source,most_enjoyable_part,focused_elements,raw_data"
      )
      .eq("id", id)
      .single();

    if (beforeError) throw beforeError;

    const rawData =
      before.raw_data &&
      typeof before.raw_data === "object" &&
      !Array.isArray(before.raw_data)
        ? before.raw_data
        : {};

    const updatedRawData = {
      ...rawData,
      ArtWorkTitleEn: updates.artwork_title_en,
      ArtworkTitleEn: updates.artwork_title_en,
      ArtWorkTitleAr: updates.artwork_title_ar,
      ArtworkTitleAr: updates.artwork_title_ar,
      ArtWorkDescrEn: updates.description_en,
      ArtworkDescriptionEn: updates.description_en,
      ArtWorkDescrAr: updates.description_ar,
      ArtworkDescriptionAr: updates.description_ar,
      "Did anyone or anything influence your idea (family, artist, place)?":
        updates.influence_idea_source,
      "Did anyone or anything influence your idea":
        updates.influence_idea_source,
      "What was the most enjoyable part of creating your work?":
        updates.most_enjoyable_part,
      "Most enjoyable part": updates.most_enjoyable_part,
      "What elements did you focus on, and why?": updates.focused_elements,
      "What elements did you focus on": updates.focused_elements,
    };

    const { error } = await supabaseAdmin
      .from("submissions")
      .update({
        ...updates,
        raw_data: updatedRawData,
      })
      .eq("id", id);

    if (error) throw error;

    await audit({
      actorId: user.id,
      action: "submission_content_updated",
      entityType: "submission",
      entityId: id,
      before,
      after: updates,
    });

    return redirectBack(req, redirectTo);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message ?? "Failed to update submission content." },
      {
        status:
          error.message === "FORBIDDEN" || error.message === "UNAUTHENTICATED"
            ? 403
            : 500,
      }
    );
  }
}