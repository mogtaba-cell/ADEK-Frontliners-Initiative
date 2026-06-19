import { NextResponse } from "next/server";
import { requireUser, hashPassword } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validRoles = new Set(["admin", "coordinator", "evaluator", "management", "proofreader", "reviewer", "categorizer", "rater", "adek_hq"]);
const validProofreaderTypes = new Set([
  "general",
  "literary_arabic",
  "literary_english_or_others",
]);

function normalizeProofreaderType(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();

  if (!text) return null;

  // Backwards-compatible aliases for older forms/imports.
  if (text === "literary") return "literary_arabic";
  if (["arabic", "arabic_literary", "literary-arabic"].includes(text)) {
    return "literary_arabic";
  }
  if (
    [
      "english",
      "english_other",
      "english_others",
      "english_or_other",
      "english_or_others",
      "english/other",
      "english/others",
      "literary_english",
      "literary-english",
      "literary_english_or_others",
    ].includes(text)
  ) {
    return "literary_english_or_others";
  }

  return validProofreaderTypes.has(text) ? text : null;
}

async function replaceReviewerLinks(reviewerId: string, proofreaderIds: string[]) {
  const { error: deleteError } = await supabaseAdmin
    .from("reviewer_proofreader_links")
    .delete()
    .eq("reviewer_id", reviewerId);

  if (deleteError) throw deleteError;

  const rows = Array.from(new Set(proofreaderIds.filter(Boolean))).map((proofreader_id) => ({
    reviewer_id: reviewerId,
    proofreader_id,
  }));

  if (rows.length) {
    const { error } = await supabaseAdmin.from("reviewer_proofreader_links").insert(rows);
    if (error) throw error;
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireUser(["admin"]);
    const f = await req.formData();

    const email = String(f.get("email") ?? "").trim().toLowerCase();
    const username = String(f.get("username") ?? "").trim().toLowerCase();
    const full_name = String(f.get("full_name") ?? "").trim();
    const role = String(f.get("role") ?? "coordinator").trim().toLowerCase();
    const password = String(f.get("password") ?? "");
    const proofreader_type = role === "proofreader" ? normalizeProofreaderType(f.get("proofreader_type")) ?? "general" : null;

    if (!validRoles.has(role)) throw new Error("Invalid role.");
    if (!email || !full_name || !role || !password) throw new Error("Missing required user fields.");

    const payload = {
      email,
      username: username || email,
      full_name,
      role,
      proofreader_type,
      password_hash: await hashPassword(password),
      is_active: true,
    };

    const { data, error } = await supabaseAdmin.from("profiles").insert(payload).select("id").single();
    if (error) throw error;

    await audit({ actorId: actor.id, action: "user_created", entityType: "profile", entityId: data.id, after: { email, role, proofreader_type } });

    return NextResponse.redirect(new URL("/admin/users", req.url));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await requireUser(["admin"]);
    const body = await req.json();
    const id = String(body.id ?? "");
    if (!id) throw new Error("Missing user id.");

    if (Array.isArray(body.reviewer_proofreader_ids)) {
      await replaceReviewerLinks(id, body.reviewer_proofreader_ids.map((x: unknown) => String(x)));
      await audit({ actorId: actor.id, action: "reviewer_links_updated", entityType: "profile", entityId: id, after: { reviewer_proofreader_ids: body.reviewer_proofreader_ids } });
      return NextResponse.json({ ok: true });
    }

    const role = String(body.role ?? "coordinator").trim().toLowerCase();
    if (!validRoles.has(role)) throw new Error("Invalid role.");

    const updates: Record<string, any> = {
      full_name: String(body.full_name ?? "").trim(),
      email: String(body.email ?? "").trim().toLowerCase(),
      username: String(body.username ?? "").trim().toLowerCase() || String(body.email ?? "").trim().toLowerCase(),
      role,
      proofreader_type: role === "proofreader" ? normalizeProofreaderType(body.proofreader_type) ?? "general" : null,
      is_active: Boolean(body.is_active),
      updated_at: new Date().toISOString(),
    };

    if (!updates.full_name || !updates.email || !updates.role) throw new Error("Missing required user fields.");
    if (body.password && String(body.password).trim().length > 0) updates.password_hash = await hashPassword(String(body.password));

    const { data: before } = await supabaseAdmin.from("profiles").select("id,email,username,full_name,role,proofreader_type,is_active").eq("id", id).single();
    const { error } = await supabaseAdmin.from("profiles").update(updates).eq("id", id);
    if (error) throw error;

    await audit({ actorId: actor.id, action: "user_updated", entityType: "profile", entityId: id, before, after: updates });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await requireUser(["admin"]);
    const body = await req.json();
    const id = String(body.id ?? "");
    if (!id) throw new Error("Missing user id.");
    if (id === actor.id) throw new Error("You cannot deactivate your own Admin account.");

    const { data: before } = await supabaseAdmin.from("profiles").select("id,email,username,full_name,role,proofreader_type,is_active").eq("id", id).single();
    const { error } = await supabaseAdmin.from("profiles").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;

    await audit({ actorId: actor.id, action: "user_deactivated", entityType: "profile", entityId: id, before, after: { is_active: false } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
