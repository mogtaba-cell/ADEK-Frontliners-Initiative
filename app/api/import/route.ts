import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createImportBatch,
  getImportBatch,
  processImportWorkbook,
} from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    await requireUser(["admin"]);

    const url = new URL(req.url);
    const batchId = url.searchParams.get("batchId");

    if (!batchId) {
      return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
    }

    const batch = await getImportBatch(batchId);

    return NextResponse.json(batch, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error: any) {
    console.error("Import progress GET failed:", error);

    return NextResponse.json(
      { error: error.message ?? "Failed to read import progress." },
      { status: error.message === "FORBIDDEN" ? 403 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(["admin"]);
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const batchId = await createImportBatch(file.name, user.id);

    after(async () => {
      try {
        await processImportWorkbook(batchId, buffer, file.name, user.id);
      } catch (error) {
        console.error("Background import failed:", error);
      }
    });

    return NextResponse.json(
      { ok: true, batchId, message: "Import started" },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error: any) {
    console.error("Import POST failed:", error);

    return NextResponse.json(
      { error: error.message ?? "Import failed to start." },
      { status: error.message === "FORBIDDEN" ? 403 : 500 }
    );
  }
}
