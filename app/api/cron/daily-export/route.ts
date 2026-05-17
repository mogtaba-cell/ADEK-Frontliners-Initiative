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

  if (!cronSecret) {
    return false;
  }

  const url = new URL(req.url);
  const secretFromQuery = url.searchParams.get("secret");
  const authorization = req.headers.get("authorization");

  return (
    secretFromQuery === cronSecret ||
    authorization === `Bearer ${cronSecret}`
  );
}

async function getAutomationUserId() {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (adminEmail) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", adminEmail)
      .eq("role", "admin")
      .maybeSingle();

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
  file: {
    id: string;
    name: string;
    webViewLink: string | null;
  };
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

export async function GET(req: Request) {
  let batchId: string | null = null;

  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized cron request.",
        },
        { status: 401 }
      );
    }

    const automationUserId = await getAutomationUserId();

    batchId = await createExportBatch({
      requestedBy: automationUserId,
      mode: "automatic",
    });

    const now = new Date();
    const folderName = safeDateName(now);
    const dateLabel = folderName;

    const exportFolder = await createDatedExportFolder({
      folderName,
    });

    await updateExportBatch({
      batchId,
      values: {
        destination_folder_id: exportFolder.id,
      },
    });

    const [
      analyticsPdfBuffer,
      activityLogBuffer,
      allSubmissionsBuffer,
      readySubmissionsBuffer,
    ] = await Promise.all([
      buildAnalyticsDashboardPdfBuffer(),
      buildActivityLogWorkbookBuffer(),
      buildAllSubmissionsWorkbookBuffer(),
      buildReadySubmissionsWorkbookBuffer(),
    ]);

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
          files: [
            `Analytics Dashboard - ${dateLabel}.pdf`,
            `Activity Log - ${dateLabel}.xlsx`,
            `All Submissions Full Data - ${dateLabel}.xlsx`,
            `Ready Submissions - ${dateLabel}.xlsx`,
            `Export Summary - ${dateLabel}.json`,
          ],
        },
        null,
        2
      )
    );

    const uploadedFiles = await Promise.all([
      uploadBufferToDrive({
        folderId: exportFolder.id,
        filename: `Analytics Dashboard - ${dateLabel}.pdf`,
        mimeType: "application/pdf",
        buffer: analyticsPdfBuffer,
      }),

      uploadBufferToDrive({
        folderId: exportFolder.id,
        filename: `Activity Log - ${dateLabel}.xlsx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: activityLogBuffer,
      }),

      uploadBufferToDrive({
        folderId: exportFolder.id,
        filename: `All Submissions Full Data - ${dateLabel}.xlsx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: allSubmissionsBuffer,
      }),

      uploadBufferToDrive({
        folderId: exportFolder.id,
        filename: `Ready Submissions - ${dateLabel}.xlsx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: readySubmissionsBuffer,
      }),

      uploadBufferToDrive({
        folderId: exportFolder.id,
        filename: `Export Summary - ${dateLabel}.json`,
        mimeType: "application/json",
        buffer: summaryBuffer,
      }),
    ]);

    await Promise.all([
      insertExportFile({
        batchId,
        dataType: "analytics_dashboard_pdf",
        file: uploadedFiles[0],
      }),

      insertExportFile({
        batchId,
        dataType: "activity_log",
        file: uploadedFiles[1],
      }),

      insertExportFile({
        batchId,
        dataType: "all_submissions_full_data",
        file: uploadedFiles[2],
      }),

      insertExportFile({
        batchId,
        dataType: "ready_submissions",
        file: uploadedFiles[3],
      }),

      insertExportFile({
        batchId,
        dataType: "export_summary",
        file: uploadedFiles[4],
      }),
    ]);

    await updateExportBatch({
      batchId,
      values: {
        status: "completed",
        completed_at: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      ok: true,
      mode: "automatic",
      batch_id: batchId,
      timezone: EXPORT_TIME_ZONE,
      date_label: dateLabel,
      folder: exportFolder,
      files: uploadedFiles,
    });
  } catch (error: any) {
    console.error("Automatic Google Drive export failed:", error);

    if (batchId) {
      await updateExportBatch({
        batchId,
        values: {
          status: "failed",
          error_message:
            error.message ?? "Automatic Google Drive export failed.",
          completed_at: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: error.message ?? "Automatic Google Drive export failed.",
      },
      { status: 500 }
    );
  }
}