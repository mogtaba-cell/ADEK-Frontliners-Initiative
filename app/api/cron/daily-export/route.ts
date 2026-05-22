import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createDatedExportFolder,
  uploadBufferToDrive,
} from "@/lib/google-drive";
import { buildAnalyticsDashboardPdfBuffer } from "@/lib/analytics-pdf";
import {
  buildActivityLogWorkbookBuffer,
  buildAllSubmissionsWorkbookBuffer,
  buildReadySubmissionsWorkbookBuffer,
} from "@/lib/export-workbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXPORT_TIME_ZONE = "Asia/Dubai";
const RECENT_BATCH_WINDOW_HOURS = 12;
const STUCK_BATCH_MINUTES = 120;

type ExportFileInfo = {
  id: string;
  name: string;
  webViewLink: string | null;
};

type ExportBatchRow = {
  id: string;
  requested_by: string | null;
  mode: string | null;
  status: string | null;
  destination_folder_id: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

type ExportStep =
  | "start"
  | "analytics_dashboard_pdf"
  | "activity_log"
  | "all_submissions_full_data"
  | "ready_submissions"
  | "export_summary"
  | "completed";

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

function isAuthorized(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const url = new URL(req.url);
  const secretFromQuery = url.searchParams.get("secret");
  const authorization = req.headers.get("authorization");

  return secretFromQuery === cronSecret || authorization === `Bearer ${cronSecret}`;
}

function errorMessage(error: any) {
  return error?.message ?? "Automatic Google Drive export failed.";
}

function recentCutoffIso() {
  return new Date(Date.now() - RECENT_BATCH_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

function stuckCutoffIso() {
  return new Date(Date.now() - STUCK_BATCH_MINUTES * 60 * 1000).toISOString();
}

async function getAutomationUserId() {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (adminEmail) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", adminEmail)
      .eq("role", "admin")
      .maybeSingle();

    if (error) {
      console.error("Automation admin lookup by ADMIN_EMAIL failed:", error.message);
    }

    if (data?.id) return data.id as string;
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not find automation admin user: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error("Could not find an admin user for automatic export.");
  }

  return data.id as string;
}

async function markOldProcessingBatchesFailed() {
  const { error } = await supabaseAdmin
    .from("export_batches")
    .update({
      status: "failed",
      error_message:
        "Automatic export was still processing after the allowed window. It was marked failed so the next scheduled export can continue safely.",
      completed_at: new Date().toISOString(),
    })
    .eq("mode", "automatic")
    .eq("status", "processing")
    .lt("created_at", stuckCutoffIso());

  if (error) {
    console.error("Could not mark old automatic export batches failed:", error.message);
  }
}

async function createExportBatch(requestedBy: string) {
  const { data, error } = await supabaseAdmin
    .from("export_batches")
    .insert({
      requested_by: requestedBy,
      mode: "automatic",
      status: "processing",
    })
    .select("id,requested_by,mode,status,destination_folder_id,error_message,created_at,completed_at")
    .single();

  if (error) {
    throw new Error(`Could not create export batch: ${error.message}`);
  }

  return data as ExportBatchRow;
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
    throw new Error(`Export batch update failed: ${error.message}`);
  }
}

async function getLatestRecentAutomaticBatch() {
  const { data, error } = await supabaseAdmin
    .from("export_batches")
    .select("id,requested_by,mode,status,destination_folder_id,error_message,created_at,completed_at")
    .eq("mode", "automatic")
    .gte("created_at", recentCutoffIso())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read latest automatic export batch: ${error.message}`);
  }

  return (data as ExportBatchRow | null) ?? null;
}

async function getOrCreateProcessingBatch() {
  await markOldProcessingBatchesFailed();

  const latest = await getLatestRecentAutomaticBatch();

  if (latest?.status === "completed") {
    return { batch: latest, alreadyCompleted: true };
  }

  if (latest?.status === "processing") {
    return { batch: latest, alreadyCompleted: false };
  }

  const automationUserId = await getAutomationUserId();
  const batch = await createExportBatch(automationUserId);
  return { batch, alreadyCompleted: false };
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
    throw new Error(`Export file log insert failed: ${error.message}`);
  }
}

async function hasExportFile(batchId: string, dataType: string) {
  const { count, error } = await supabaseAdmin
    .from("export_files")
    .select("id", { count: "exact", head: true })
    .eq("export_batch_id", batchId)
    .eq("data_type", dataType);

  if (error) {
    throw new Error(`Could not check export file ${dataType}: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

async function failBatch(batchId: string | null, message: string) {
  if (!batchId) return;

  try {
    await updateExportBatch({
      batchId,
      values: {
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Could not mark automatic export failed:", error);
  }
}

async function uploadStepFile({
  batchId,
  folderId,
  filename,
  mimeType,
  dataType,
  buildBuffer,
}: {
  batchId: string;
  folderId: string;
  filename: string;
  mimeType: string;
  dataType: string;
  buildBuffer: () => Promise<Buffer>;
}) {
  if (await hasExportFile(batchId, dataType)) {
    return { skipped: true, reason: `${dataType} already uploaded.` };
  }

  const buffer = await buildBuffer();
  const file = await uploadBufferToDrive({
    folderId,
    filename,
    mimeType,
    buffer,
  });

  await insertExportFile({ batchId, dataType, file });
  return { skipped: false, file };
}

function nextMissingStep(batch: ExportBatchRow, existingDataTypes: Set<string>): ExportStep {
  if (!batch.destination_folder_id) return "start";
  if (!existingDataTypes.has("analytics_dashboard_pdf")) return "analytics_dashboard_pdf";
  if (!existingDataTypes.has("activity_log")) return "activity_log";
  if (!existingDataTypes.has("all_submissions_full_data")) return "all_submissions_full_data";
  if (!existingDataTypes.has("ready_submissions")) return "ready_submissions";
  if (!existingDataTypes.has("export_summary")) return "export_summary";
  return "completed";
}

async function runNextStep(batch: ExportBatchRow) {
  const dateLabel = safeDateName(new Date(batch.created_at));
  const files = await getExportFiles(batch.id);
  const existingDataTypes = new Set(files.map((file: any) => String(file.data_type ?? "")));
  const step = nextMissingStep(batch, existingDataTypes);

  if (step === "completed") {
    await updateExportBatch({
      batchId: batch.id,
      values: {
        status: "completed",
        completed_at: new Date().toISOString(),
        error_message: null,
      },
    });

    return { step, message: "Automatic export already has all files and was marked completed." };
  }

  if (step === "start") {
    const exportFolder = await createDatedExportFolder({ folderName: dateLabel });

    await updateExportBatch({
      batchId: batch.id,
      values: {
        destination_folder_id: exportFolder.id,
      },
    });

    return { step, folder: exportFolder, message: "Created Google Drive export folder." };
  }

  const folderId = batch.destination_folder_id;
  if (!folderId) throw new Error("Automatic export batch is missing destination folder.");

  if (step === "analytics_dashboard_pdf") {
    const result = await uploadStepFile({
      batchId: batch.id,
      folderId,
      filename: `Analytics Dashboard - ${dateLabel}.pdf`,
      mimeType: "application/pdf",
      dataType: "analytics_dashboard_pdf",
      buildBuffer: buildAnalyticsDashboardPdfBuffer,
    });

    return { step, ...result };
  }

  if (step === "activity_log") {
    const result = await uploadStepFile({
      batchId: batch.id,
      folderId,
      filename: `Activity Log - ${dateLabel}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dataType: "activity_log",
      buildBuffer: buildActivityLogWorkbookBuffer,
    });

    return { step, ...result };
  }

  if (step === "all_submissions_full_data") {
    const result = await uploadStepFile({
      batchId: batch.id,
      folderId,
      filename: `All Submissions Full Data - ${dateLabel}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dataType: "all_submissions_full_data",
      buildBuffer: buildAllSubmissionsWorkbookBuffer,
    });

    return { step, ...result };
  }

  if (step === "ready_submissions") {
    const result = await uploadStepFile({
      batchId: batch.id,
      folderId,
      filename: `Ready Submissions - ${dateLabel}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dataType: "ready_submissions",
      buildBuffer: buildReadySubmissionsWorkbookBuffer,
    });

    return { step, ...result };
  }

  const refreshedFiles = await getExportFiles(batch.id);
  const summaryBuffer = Buffer.from(
    JSON.stringify(
      {
        export_mode: "automatic",
        exported_at_utc: new Date().toISOString(),
        exported_at_uae_label: dateLabel,
        timezone: EXPORT_TIME_ZONE,
        requested_by_user_id: batch.requested_by,
        parent_folder: "Data export",
        folder_id: folderId,
        files: refreshedFiles,
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
    batchId: batch.id,
    dataType: "export_summary",
    file: summaryFile,
  });

  await updateExportBatch({
    batchId: batch.id,
    values: {
      status: "completed",
      completed_at: new Date().toISOString(),
      error_message: null,
    },
  });

  return { step, file: summaryFile };
}

export async function GET(req: Request) {
  let batchId: string | null = null;

  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized cron request." },
        { status: 401 }
      );
    }

    const { batch, alreadyCompleted } = await getOrCreateProcessingBatch();
    batchId = batch.id;

    if (alreadyCompleted) {
      return NextResponse.json({
        ok: true,
        batchId: batch.id,
        status: batch.status,
        message: "Recent automatic export is already completed.",
      });
    }

    const result = await runNextStep(batch);

    return NextResponse.json({
      ok: true,
      batchId: batch.id,
      status: "processing",
      result,
    });
  } catch (error: any) {
    const message = errorMessage(error);
    console.error("Automatic Google Drive export step failed:", error);

    await failBatch(batchId, message);

    return NextResponse.json(
      {
        ok: false,
        batchId,
        error: message,
      },
      { status: 500 }
    );
  }
}
