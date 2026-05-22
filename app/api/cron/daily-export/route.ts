import { NextResponse } from "next/server";
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

function isAuthorized(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const url = new URL(req.url);
  const secretFromQuery = url.searchParams.get("secret");
  const authorization = req.headers.get("authorization");

  return (
    secretFromQuery === cronSecret ||
    authorization === `Bearer ${cronSecret}`
  );
}

function errorMessage(error: any) {
  return error?.message ?? "Automatic Google Drive export failed.";
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
      console.error(
        "Automation admin lookup by ADMIN_EMAIL failed:",
        error.message
      );
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

async function failOldProcessingAutomaticExports() {
  const { error } = await supabaseAdmin
    .from("export_batches")
    .update({
      status: "failed",
      error_message:
        "Automatic export was left processing from a previous timed out or interrupted run.",
      completed_at: new Date().toISOString(),
    })
    .eq("mode", "automatic")
    .eq("status", "processing")
    .lt(
      "created_at",
      new Date(Date.now() - 15 * 60 * 1000).toISOString()
    );

  if (error) {
    console.error("Could not fail old processing automatic exports:", error.message);
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

async function buildAndUpload({
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
  const buffer = await buildBuffer();

  const file = await uploadBufferToDrive({
    folderId,
    filename,
    mimeType,
    buffer,
  });

  await insertExportFile({
    batchId,
    dataType,
    file,
  });

  return file;
}

export async function GET(req: Request) {
  let batchId: string | null = null;
  let currentStep = "starting automatic export";

  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized cron request." },
        { status: 401 }
      );
    }

    await failOldProcessingAutomaticExports();

    const automationUserId = await getAutomationUserId();

    batchId = await createExportBatch({
      requestedBy: automationUserId,
      mode: "automatic",
    });

    const now = new Date();
    const dateLabel = safeDateName(now);

    currentStep = "creating Google Drive export folder";
    const exportFolder = await createDatedExportFolder({
      folderName: dateLabel,
    });

    await updateExportBatch({
      batchId,
      values: {
        destination_folder_id: exportFolder.id,
      },
    });

    currentStep = "building and uploading Analytics Dashboard PDF";
    await buildAndUpload({
      batchId,
      folderId: exportFolder.id,
      filename: `Analytics Dashboard - ${dateLabel}.pdf`,
      mimeType: "application/pdf",
      dataType: "analytics_dashboard_pdf",
      buildBuffer: buildAnalyticsDashboardPdfBuffer,
    });

    currentStep = "building and uploading Activity Log workbook";
    await buildAndUpload({
      batchId,
      folderId: exportFolder.id,
      filename: `Activity Log - ${dateLabel}.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dataType: "activity_log",
      buildBuffer: buildActivityLogWorkbookBuffer,
    });

    currentStep = "building submissions workbooks";
    const { allSubmissionsBuffer, readySubmissionsBuffer } =
      await buildSubmissionWorkbookBuffers();

    currentStep = "uploading All Submissions workbook";
    const allSubmissionsFile = await uploadBufferToDrive({
      folderId: exportFolder.id,
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

    currentStep = "uploading Ready Submissions workbook";
    const readySubmissionsFile = await uploadBufferToDrive({
      folderId: exportFolder.id,
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

    currentStep = "writing export summary";
    const filesBeforeSummary = await getExportFiles(batchId);

    const summaryBuffer = Buffer.from(
      JSON.stringify(
        {
          export_mode: "automatic",
          exported_at_utc: now.toISOString(),
          exported_at_uae_label: dateLabel,
          timezone: EXPORT_TIME_ZONE,
          requested_by_user_id: automationUserId,
          parent_folder: "Data export",
          folder: exportFolder,
          files: filesBeforeSummary,
        },
        null,
        2
      )
    );

    const summaryFile = await uploadBufferToDrive({
      folderId: exportFolder.id,
      filename: `Export Summary - ${dateLabel}.json`,
      mimeType: "application/json",
      buffer: summaryBuffer,
    });

    await insertExportFile({
      batchId,
      dataType: "export_summary",
      file: summaryFile,
    });

    const files = await getExportFiles(batchId);

    await updateExportBatch({
      batchId,
      values: {
        status: "completed",
        completed_at: new Date().toISOString(),
        error_message: null,
      },
    });

    return NextResponse.json({
      ok: true,
      batchId,
      folder: exportFolder,
      files,
    });
  } catch (error: any) {
    const message = `${currentStep} failed. ${errorMessage(error)}`;
    console.error("Automatic Google Drive export failed:", error);

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