import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { homeForRole, normalizeRole, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const identifier = String(form.get("identifier") ?? "")
      .trim()
      .toLowerCase();

    const password = String(form.get("password") ?? "");

    if (!identifier || !password) {
      return NextResponse.redirect(new URL("/login?error=1", req.url));
    }

    const { data: user, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .or(`email.eq.${identifier},username.eq.${identifier}`)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("Login lookup error:", error.message);
      return NextResponse.redirect(new URL("/login?error=1", req.url));
    }

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return NextResponse.redirect(new URL("/login?error=1", req.url));
    }

    const role = normalizeRole(user.role);

    if (!role) {
      return NextResponse.redirect(new URL("/login?error=role", req.url));
    }

    const token = randomUUID() + randomUUID();
    const expiresDate = new Date(Date.now() + 1000 * 60 * 60 * 12);

    const { error: sessionError } = await supabaseAdmin.from("sessions").insert({
      user_id: user.id,
      token,
      expires_at: expiresDate.toISOString(),
    });

    if (sessionError) {
      console.error("Session creation error:", sessionError.message);
      return NextResponse.redirect(new URL("/login?error=1", req.url));
    }

    const res = NextResponse.redirect(new URL(homeForRole(role), req.url));

    res.cookies.set("afi_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresDate,
    });

    return res;
  } catch (error) {
    console.error("Login route failed:", error);
    return NextResponse.redirect(new URL("/login?error=1", req.url));
  }
}