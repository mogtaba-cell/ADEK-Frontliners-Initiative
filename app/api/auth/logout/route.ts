import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
export async function GET(req:Request){ const c=await cookies(); const token=c.get("afi_session")?.value; if(token) await supabaseAdmin.from("sessions").delete().eq("token",token); const res=NextResponse.redirect(new URL("/login",req.url)); res.cookies.delete("afi_session"); return res; }
