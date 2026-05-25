import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createDatedExportFolder,
  uploadBufferToDrive,
} from "@/lib/google-drive";
import { buildAnalyticsDashboardPdfBuffer } from "@/lib/analytics-pdf";
import {
  buildActivityLogWorkbookBuffer,
  buildSubmissionWorkbookBuffers,
} from "@/lib/export-workbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXPORT_TIME_ZONE = "Asia/Dubai";
const MANUAL_EXPORT_PASSWORD = process.env.MANUAL_EXPORT_PASSWORD || "726642";

type ExportFileInfo = {
  id: string;
  name: string;
  webViewLink: string | null;
};

function getDubaiDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: EXPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    yyyy: get("year"),
    mm: get("month"),
    dd: get("day"),
    hh: get("hour"),
    min: get("minute"),
  };
}

function safeDateName(date = new Date()) {
  const { yyyy, mm, dd, hh, min } = getDubaiDateParts(date);
  return `${yyyy}-${mm}-${dd} ${hh}-${min} UAE`;
}

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function textValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function errorMessage(error: any) {
  return error?.message ?? "Google Drive export failed.";
}

function validateManualExportPassword(form: FormData) {
  const submittedPassword = textValue(form, "export_password");

  if (!submittedPassword || submittedPassword !== MANUAL_EXPORT_PASSWORD) {
    throw new Error("Invalid manual export password.");
  }
}

async function createExportBatch({
  requestedBy,
  mode,
}: {
  requestedBy: string;
  mode: "manual" | "automatic";
}) {
  const { data, error } = await supabaseAdmin
    .from("export_batches")
    .insert({
      requested_by: requestedBy,
      mode,
      status: "processing",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not create export batch: ${error.message}`);
  }

  return data.id as string;
}

async function updateExportBatch({
  batchId,
  values,
}: {
  batchId: string;
  values: Record<string, any>;
}) {
  const { error } = await supabaseAdmin
    .from("export_batches")
    .update(values)
    .eq("id", batchId);

  if (error) {
    console.error("Export batch update failed:", error.message);
  }
}

async function insertExportFile({
  batchId,
  dataType,
  file,
}: {
  batchId: string;
  dataType: string;
  file: ExportFileInfo;
}) {
  const { error } = await supabaseAdmin.from("export_files").insert({
    export_batch_id: batchId,
    data_type: dataType,
    file_name: file.name,
    google_file_id: file.id,
    google_file_url: file.webViewLink,
  });

  if (error) {
    console.error("Export file log insert failed:", error.message);
  }
}

async function getExportFiles(batchId: string) {
  const { data, error } = await supabaseAdmin
    .from("export_files")
    .select("data_type,file_name,google_file_id,google_file_url,created_at")
    .eq("export_batch_id", batchId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not read export files: ${error.message}`);
  }

  return data ?? [];
}

async function failBatch(batchId: string | null, message: string) {
  if (!batchId) return;

  await updateExportBatch({
    batchId,
    values: {
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    },
  });
}

async function readBatchFolder(batchId: string) {
  const { data, error } = await supabaseAdmin
    .from("export_batches")
    .select("destination_folder_id")
    .eq("id", batchId)
    .single();

  if (error) {
    throw new Error(`Could not read export batch: ${error.message}`);
  }

  if (!data?.destination_folder_id) {
    throw new Error("Export batch is missing destination folder.");
  }

  return data.destination_folder_id as string;
}

async function handleStart(user: any) {
  const batchId = await createExportBatch({
    requestedBy: user.id,
    mode: "manual",
  });

  const now = new Date();
  const dateLabel = safeDateName(now);
  const exportFolder = await createDatedExportFolder({
    folderName: dateLabel,
  });

  await updateExportBatch({
    batchId,
    values: {
      destination_folder_id: exportFolder.id,
    },
  });

  return json({
    ok: true,
    batchId,
    dateLabel,
    folder: exportFolder,
  });
}

async function handleAnalytics(form: FormData) {
  const batchId = textValue(form, "batch_id");
  const folderId = textValue(form, "folder_id") || (await readBatchFolder(batchId));
  const dateLabel = textValue(form, "date_label") || safeDateName();

  if (!batchId) throw new Error("Missing export batch ID.");

  const uploadedPdf = form.get("analytics_pdf");
  let pdfBuffer: Buffer;

  if (uploadedPdf instanceof File && uploadedPdf.size > 0) {
    pdfBuffer = Buffer.from(await uploadedPdf.arrayBuffer());
  } else {
    pdfBuffer = await buildAnalyticsDashboardPdfBuffer();
  }

  const file = await uploadBufferToDrive({
    folderId,
    filename: `Analytics Dashboard - ${dateLabel}.pdf`,
    mimeType: "application/pdf",
    buffer: pdfBuffer,
  });

  await insertExportFile({
    batchId,
    dataType: "analytics_dashboard_pdf",
    file,
  });

  return json({ ok: true, file });
}

async function handleActivity(form: FormData) {
  const batchId = textValue(form, "batch_id");
  const folderId = textValue(form, "folder_id") || (await readBatchFolder(batchId));
  const dateLabel = textValue(form, "date_label") || safeDateName();

  if (!batchId) throw new Error("Missing export batch ID.");

  const activityLogBuffer = await buildActivityLogWorkbookBuffer();
  const file = await uploadBufferToDrive({
    folderId,
    filename: `Activity Log - ${dateLabel}.xlsx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: activityLogBuffer,
  });

  await insertExportFile({
    batchId,
    dataType: "activity_log",
    file,
  });

  return json({ ok: true, file });
}

async function handleSubmissions(form: FormData) {
  const batchId = textValue(form, "batch_id");
  const folderId = textValue(form, "folder_id") || (await readBatchFolder(batchId));
  const dateLabel = textValue(form, "date_label") || safeDateName();

  if (!batchId) throw new Error("Missing export batch ID.");

  const { allSubmissionsBuffer, readySubmissionsBuffer } =
    await buildSubmissionWorkbookBuffers();

  const allSubmissionsFile = await uploadBufferToDrive({
    folderId,
    filename: `All Submissions Full Data - ${dateLabel}.xlsx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: allSubmissionsBuffer,
  });

  await insertExportFile({
    batchId,
    dataType: "all_submissions_full_data",
    file: allSubmissionsFile,
  });

  const readySubmissionsFile = await uploadBufferToDrive({
    folderId,
    filename: `Ready Submissions - ${dateLabel}.xlsx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readySubmissionsBuffer,
  });

  await insertExportFile({
    batchId,
    dataType: "ready_submissions",
    file: readySubmissionsFile,
  });

  return json({
    ok: true,
    files: [allSubmissionsFile, readySubmissionsFile],
  });
}

async function handleSummary(form: FormData, user: any) {
  const batchId = textValue(form, "batch_id");
  const folderId = textValue(form, "folder_id") || (await readBatchFolder(batchId));
  const dateLabel = textValue(form, "date_label") || safeDateName();

  if (!batchId) throw new Error("Missing export batch ID.");

  const files = await getExportFiles(batchId);
  const now = new Date();
  const summaryBuffer = Buffer.from(
    JSON.stringify(
      {
        exported_at_utc: now.toISOString(),
        exported_at_uae_label: dateLabel,
        timezone: EXPORT_TIME_ZONE,
        exported_by: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
        },
        parent_folder: "Data export",
        folder_id: folderId,
        files,
      },
      null,
      2
    )
  );

  const summaryFile = await uploadBufferToDrive({
    folderId,
    filename: `Export Summary - ${dateLabel}.json`,
    mimeType: "application/json",
    buffer: summaryBuffer,
  });

  await insertExportFile({
    batchId,
    dataType: "export_summary",
    file: summaryFile,
  });

  await updateExportBatch({
    batchId,
    values: {
      status: "completed",
      completed_at: new Date().toISOString(),
      error_message: null,
    },
  });

  const finalFiles = await getExportFiles(batchId);

  return json({
    ok: true,
    file: summaryFile,
    files: finalFiles,
  });
}

export async function GET(req: Request) {
  return NextResponse.redirect(new URL("/admin/export", req.url), {
    status: 303,
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "start";
  let batchId: string | null = null;

  try {
    const user = await requireUser(["admin"]);
    const form = await req.formData();

    validateManualExportPassword(form);

    batchId = textValue(form, "batch_id") || null;

    if (action === "start") return await handleStart(user);
    if (action === "analytics") return await handleAnalytics(form);
    if (action === "activity") return await handleActivity(form);
    if (action === "submissions") return await handleSubmissions(form);
    if (action === "summary") return await handleSummary(form, user);

    return json(
      {
        ok: false,
        error:
          "Unknown export action. Use the Export & Backup page instead of opening this API URL directly.",
      },
      400
    );
  } catch (error: any) {
    const message = errorMessage(error);
    console.error(`Google Drive export step failed (${action}):`, error);

    await failBatch(batchId, message);

    return json(
      {
        ok: false,
        action,
        error: message,
      },
      500
    );
  }
}