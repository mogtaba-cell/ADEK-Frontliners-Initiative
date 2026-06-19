import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ProofreaderType, Role } from "@/lib/types";

export type CurrentUser = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  proofreader_type?: ProofreaderType | null;
};

const validRoles = new Set([
  "admin",
  "coordinator",
  "evaluator",
  "management",
  "proofreader",
  "reviewer",
  "categorizer",
  "rater",
  "adek_hq",
]);

export function normalizeRole(role: unknown): Role | null {
  const value = String(role ?? "").trim().toLowerCase();
  return validRoles.has(value) ? (value as Role) : null;
}

export function homeForRole(role: Role | string) {
  const normalized = normalizeRole(role);

  switch (normalized) {
    case "admin":
      return "/admin";
    case "coordinator":
      return "/coordinator";
    case "evaluator":
      return "/evaluator";
    case "management":
      return "/management";
    case "proofreader":
      return "/proofreader";
    case "reviewer":
      return "/reviewer";
    case "categorizer":
      return "/categorizer";
    case "rater":
      return "/rater";
    case "adek_hq":
      return "/submissions";
    default:
      return "/login?error=role";
  }
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("afi_session")?.value;

  if (!token) return null;

  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id,user_id,expires_at,profiles(id,email,full_name,role,is_active,proofreader_type)")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("Session lookup error:", error.message);
    return null;
  }

  if (!data || new Date(data.expires_at) < new Date()) return null;

  const nested = (data as any).profiles;
  const profile = Array.isArray(nested) ? nested[0] : nested;

  if (!profile?.is_active) return null;

  const role = normalizeRole(profile.role);
  if (!role) {
    console.error("Invalid user role:", profile.role);
    return null;
  }

  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    role,
    is_active: profile.is_active,
    proofreader_type: profile.proofreader_type ?? null,
  };
}

export async function requireUser(roles?: Role[]) {
  const user = await getCurrentUser();

  if (!user) throw new Error("UNAUTHENTICATED");
  if (roles && !roles.includes(user.role)) throw new Error("FORBIDDEN");

  return user;
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}
