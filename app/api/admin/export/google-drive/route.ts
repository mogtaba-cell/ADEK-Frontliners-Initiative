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
  buildAllSubmissionsWorkbookBuffer,
  buildReadySubmissionsWorkbookBuffer,
} from "@/lib/export-workbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeDateName(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}-${min}`;
}

function redirectBack(req: Request, params: Record<string, string>) {
  const url = new URL("/admin/export", req.url);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url);
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

export async function POST(req: Request) {
  let batchId: string | null = null;

  try {
    const user = await requireUser(["admin"]);

    batchId = await createExportBatch({
      requestedBy: user.id,
      mode: "manual",
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
          exported_at: now.toISOString(),
          exported_by: {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            role: user.role,
          },
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

    return redirectBack(req, {
      success: "1",
    });
  } catch (error: any) {
    console.error("Google Drive export failed:", error);

    if (batchId) {
      await updateExportBatch({
        batchId,
        values: {
          status: "failed",
          error_message: error.message ?? "Google Drive export failed.",
          completed_at: new Date().toISOString(),
        },
      });
    }

    return redirectBack(req, {
      error: error.message ?? "Google Drive export failed.",
    });
  }
}