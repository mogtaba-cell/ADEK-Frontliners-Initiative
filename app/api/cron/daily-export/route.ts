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
const PROCESSING_REUSE_HOURS = 12;
const COMPLETED_EXPORT_GUARD_HOURS = 12;
const STALE_PROCESSING_HOURS = 18;

type ExportFileInfo = {
  id: string;
  name: string;
  webViewLink: string | null;
};

type ExportBatch = {
  id: string;
  requested_by: string | null;
  mode: string;
  status: string;
  destination_folder_id: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
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

function hoursAgoIso(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function folderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
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

async function failVeryOldProcessingAutomaticExports() {
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
    .lt("created_at", hoursAgoIso(STALE_PROCESSING_HOURS));

  if (error) {
    console.error(
      "Could not fail old processing automatic exports:",
      error.message
    );
  }
}

async function getRecentCompletedAutomaticExport() {
  const { data, error } = await supabaseAdmin
    .from("export_batches")
    .select(
      "id,requested_by,mode,status,destination_folder_id,error_message,created_at,completed_at"
    )
    .eq("mode", "automatic")
    .eq("status", "completed")
    .gte("created_at", hoursAgoIso(COMPLETED_EXPORT_GUARD_HOURS))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not check recent completed export: ${error.message}`);
  }

  return (data as ExportBatch | null) ?? null;
}

async function getProcessingAutomaticExport() {
  const { data, error } = await supabaseAdmin
    .from("export_batches")
    .select(
      "id,requested_by,mode,status,destination_folder_id,error_message,created_at,completed_at"
    )
    .eq("mode", "automatic")
    .eq("status", "processing")
    .gte("created_at", hoursAgoIso(PROCESSING_REUSE_HOURS))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not check processing export: ${error.message}`);
  }

  return (data as ExportBatch | null) ?? null;
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
    .select(
      "id,requested_by,mode,status,destination_folder_id,error_message,created_at,completed_at"
    )
    .single();

  if (error) {
    throw new Error(`Could not create export batch: ${error.message}`);
  }

  return data as ExportBatch;
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

async function getExportFileTypes(batchId: string) {
  const files = await getExportFiles(batchId);
  return new Set(files.map((file) => file.data_type));
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
  } catch (error: any) {
    console.error("Could not mark automatic export failed:", error.message);
  }
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

async function getOrCreateAutomaticBatch() {
  const automationUserId = await getAutomationUserId();

  const processingBatch = await getProcessingAutomaticExport();
  if (processingBatch) {
    return {
      batch: processingBatch,
      automationUserId,
      isNew: false,
    };
  }

  const recentCompleted = await getRecentCompletedAutomaticExport();
  if (recentCompleted) {
    return {
      batch: recentCompleted,
      automationUserId,
      isNew: false,
      alreadyCompletedRecently: true,
    };
  }

  const newBatch = await createExportBatch({
    requestedBy: automationUserId,
    mode: "automatic",
  });

  return {
    batch: newBatch,
    automationUserId,
    isNew: true,
  };
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

    await failVeryOldProcessingAutomaticExports();

    const { batch, automationUserId, alreadyCompletedRecently } =
      await getOrCreateAutomaticBatch();

    batchId = batch.id;

    if (alreadyCompletedRecently) {
      return NextResponse.json({
        ok: true,
        batchId: batch.id,
        status: "already_completed_recently",
        destination_folder_id: batch.destination_folder_id,
        message:
          "A completed automatic export already exists recently. No new export was started.",
      });
    }

    const dateLabel = safeDateName(new Date(batch.created_at));
    let folderId = batch.destination_folder_id;

    if (!folderId) {
      currentStep = "creating Google Drive export folder";

      const exportFolder = await createDatedExportFolder({
        folderName: dateLabel,
      });

      folderId = exportFolder.id;

      await updateExportBatch({
        batchId: batch.id,
        values: {
          destination_folder_id: folderId,
        },
      });

      return NextResponse.json({
        ok: true,
        batchId: batch.id,
        status: "processing",
        step_completed: "folder_created",
        destination_folder_id: folderId,
        folder: exportFolder,
        next_step: "analytics_dashboard_pdf",
      });
    }

    const existingTypes = await getExportFileTypes(batch.id);

    if (!existingTypes.has("analytics_dashboard_pdf")) {
      currentStep = "building and uploading Analytics Dashboard PDF";

      const file = await buildAndUpload({
        batchId: batch.id,
        folderId,
        filename: `Analytics Dashboard - ${dateLabel}.pdf`,
        mimeType: "application/pdf",
        dataType: "analytics_dashboard_pdf",
        buildBuffer: buildAnalyticsDashboardPdfBuffer,
      });

      return NextResponse.json({
        ok: true,
        batchId: batch.id,
        status: "processing",
        step_completed: "analytics_dashboard_pdf",
        file,
        next_step: "activity_log",
      });
    }

    if (!existingTypes.has("activity_log")) {
      currentStep = "building and uploading Activity Log workbook";

      const file = await buildAndUpload({
        batchId: batch.id,
        folderId,
        filename: `Activity Log - ${dateLabel}.xlsx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        dataType: "activity_log",
        buildBuffer: buildActivityLogWorkbookBuffer,
      });

      return NextResponse.json({
        ok: true,
        batchId: batch.id,
        status: "processing",
        step_completed: "activity_log",
        file,
        next_step: "submissions_workbooks",
      });
    }

    if (
      !existingTypes.has("all_submissions_full_data") ||
      !existingTypes.has("ready_submissions")
    ) {
      currentStep = "building submissions workbooks";

      const { allSubmissionsBuffer, readySubmissionsBuffer } =
        await buildSubmissionWorkbookBuffers();

      const uploadedFiles: ExportFileInfo[] = [];

      if (!existingTypes.has("all_submissions_full_data")) {
        currentStep = "uploading All Submissions workbook";

        const allSubmissionsFile = await uploadBufferToDrive({
          folderId,
          filename: `All Submissions Full Data - ${dateLabel}.xlsx`,
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: allSubmissionsBuffer,
        });

        await insertExportFile({
          batchId: batch.id,
          dataType: "all_submissions_full_data",
          file: allSubmissionsFile,
        });

        uploadedFiles.push(allSubmissionsFile);
      }

      if (!existingTypes.has("ready_submissions")) {
        currentStep = "uploading Ready Submissions workbook";

        const readySubmissionsFile = await uploadBufferToDrive({
          folderId,
          filename: `Ready Submissions - ${dateLabel}.xlsx`,
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: readySubmissionsBuffer,
        });

        await insertExportFile({
          batchId: batch.id,
          dataType: "ready_submissions",
          file: readySubmissionsFile,
        });

        uploadedFiles.push(readySubmissionsFile);
      }

      return NextResponse.json({
        ok: true,
        batchId: batch.id,
        status: "processing",
        step_completed: "submissions_workbooks",
        files: uploadedFiles,
        next_step: "export_summary",
      });
    }

    if (!existingTypes.has("export_summary")) {
      currentStep = "writing export summary";

      const filesBeforeSummary = await getExportFiles(batch.id);

      const summaryBuffer = Buffer.from(
        JSON.stringify(
          {
            export_mode: "automatic",
            exported_at_utc: new Date().toISOString(),
            exported_at_uae_label: dateLabel,
            timezone: EXPORT_TIME_ZONE,
            requested_by_user_id: automationUserId,
            parent_folder: "Data export",
            folder: {
              id: folderId,
              webViewLink: folderUrl(folderId),
            },
            files: filesBeforeSummary,
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

      const files = await getExportFiles(batch.id);

      await updateExportBatch({
        batchId: batch.id,
        values: {
          status: "completed",
          completed_at: new Date().toISOString(),
          error_message: null,
        },
      });

      return NextResponse.json({
        ok: true,
        batchId: batch.id,
        status: "completed",
        destination_folder_id: folderId,
        folder_url: folderUrl(folderId),
        step_completed: "export_summary",
        files,
      });
    }

    await updateExportBatch({
      batchId: batch.id,
      values: {
        status: "completed",
        completed_at: batch.completed_at ?? new Date().toISOString(),
        error_message: null,
      },
    });

    const files = await getExportFiles(batch.id);

    return NextResponse.json({
      ok: true,
      batchId: batch.id,
      status: "completed",
      destination_folder_id: folderId,
      folder_url: folderUrl(folderId),
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