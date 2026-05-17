import "server-only";
import ExcelJS from "exceljs";
import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";
import { Readable } from "stream";

const folders = ["01_uploaded_data","02_import_logs","03_submissions_master","04_assignments","05_coordinator_checks","06_evaluations","07_management_review","08_proofreading","09_final_review","10_comments","11_audit_logs","12_analytics"];

export async function createWorkbookFromRows(sheetName:string, rows:any[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  ws.columns = keys.map(k => ({ header:k, key:k, width: Math.min(Math.max(k.length+2, 14), 42) }));
  rows.forEach(r => ws.addRow(r));
  ws.getRow(1).font = { bold:true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function driveClient() {
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) throw new Error("Google credentials missing");
  const auth = new google.auth.JWT({
    email: env.GOOGLE_CLIENT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  return google.drive({ version: "v3", auth });
}
async function ensureFolder(drive:any, name:string, parent:string) {
  const q = `'${parent}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await drive.files.list({ q, fields:"files(id,name)", supportsAllDrives:true, includeItemsFromAllDrives:true });
  if (list.data.files?.[0]?.id) return list.data.files[0].id;
  const res = await drive.files.create({ requestBody:{ name, mimeType:"application/vnd.google-apps.folder", parents:[parent] }, fields:"id", supportsAllDrives:true });
  return res.data.id;
}
async function upload(drive:any, folderId:string, name:string, buffer:Buffer, mimeType:string) {
  const stream = Readable.from(buffer);
  const res = await drive.files.create({ requestBody:{ name, parents:[folderId] }, media:{ mimeType, body:stream }, fields:"id,webViewLink", supportsAllDrives:true });
  return res.data;
}

export async function exportAllToDrive(requestedBy:string|null, mode:"manual"|"automatic"="manual") {
  const parent = env.GOOGLE_SHARED_DRIVE_FOLDER_ID;
  if (!parent) throw new Error("GOOGLE_SHARED_DRIVE_FOLDER_ID missing");
  const drive = driveClient();
  const date = new Date().toISOString().slice(0,10);
  const dateFolder = await ensureFolder(drive, date, parent);
  const folderIds:Record<string,string> = {};
  for (const f of folders) folderIds[f] = await ensureFolder(drive, f, dateFolder!);
  const batch = await supabaseAdmin.from("export_batches").insert({ requested_by:requestedBy, mode, destination_folder_id:dateFolder, status:"processing" }).select("id").single();
  if (batch.error) throw batch.error;
  const datasets = [
    ["03_submissions_master", "submissions", "submissions.xlsx"],
    ["04_assignments", "assignments", "assignments.xlsx"],
    ["06_evaluations", "evaluations", "evaluations.xlsx"],
    ["07_management_review", "management_reviews", "management_reviews.xlsx"],
    ["08_proofreading", "proofreading_tasks", "proofreading_tasks.xlsx"],
    ["09_final_review", "final_reviews", "final_reviews.xlsx"],
    ["10_comments", "comments", "comments.xlsx"],
    ["11_audit_logs", "audit_logs", "audit_logs.xlsx"],
    ["02_import_logs", "import_batches", "import_batches.xlsx"]
  ];
  try {
    for (const [folder, table, filename] of datasets) {
      const { data, error } = await supabaseAdmin.from(table).select("*").limit(50000);
      if (error) throw error;
      const buffer = await createWorkbookFromRows(table, data ?? []);
      const uploaded = await upload(drive, folderIds[folder], `${date}_${filename}`, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      await supabaseAdmin.from("export_files").insert({ export_batch_id:batch.data.id, data_type:table, file_name:`${date}_${filename}`, google_file_id:uploaded.id, google_file_url:uploaded.webViewLink });
    }
    await supabaseAdmin.from("export_batches").update({ status:"completed", completed_at:new Date().toISOString() }).eq("id", batch.data.id);
    return { exportBatchId:batch.data.id, folderId:dateFolder };
  } catch(e:any) {
    await supabaseAdmin.from("export_batches").update({ status:"failed", error_message:e.message, completed_at:new Date().toISOString() }).eq("id", batch.data.id);
    throw e;
  }
}
