import { NextResponse } from "next/server"; import { requireUser } from "@/lib/auth"; import { exportAllToDrive } from "@/lib/export";
export async function POST(){ try{ const user=await requireUser(["admin"]); const result=await exportAllToDrive(user.id,"manual"); return NextResponse.json(result); } catch(e:any){ return NextResponse.json({error:e.message},{status:500}); }}
