import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createImportBatch, getImportBatch, processImportWorkbook } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser(["admin"]);
    const url = new URL(req.url);
    const batchId = url.searchParams.get("batchId");

    if (!batchId) return NextResponse.json({ error: "Missing batchId" }, { status: 400 });

    const batch = await getImportBatch(batchId);
    return NextResponse.json(batch);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.message === "FORBIDDEN" ? 403 : 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(["admin"]);
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const batchId = await createImportBatch(file.name, user.id);

    processImportWorkbook(batchId, buffer, file.name, user.id).catch((error) => {
      console.error("Background import failed:", error);
    });

    return NextResponse.json({ ok: true, batchId, message: "Import started" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.message === "FORBIDDEN" ? 403 : 500 });
  }
}
