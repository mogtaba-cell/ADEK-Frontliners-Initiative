import { NextResponse } from "next/server"; import { exportAllToDrive } from "@/lib/export";
export async function GET(req:Request){ const auth=req.headers.get("authorization"); if(auth!==`Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({error:"Unauthorized"},{status:401}); const result=await exportAllToDrive(null,"automatic"); return NextResponse.json(result); }
