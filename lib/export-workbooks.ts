import "server-only";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type AnyRow = Record<string, any>;

const SUBMISSION_SELECT = `
  id,
  reference_id,
  created_at,
  updated_at,
  registration_status,
  workflow_status,
  evaluation_decision,
  management_decision,
  reviewer_decision,
  completed_at,
  artwork_title_en,
  artwork_title_ar,
  art_pathway_name_en,
  art_pathway_name_ar,
  art_sub_pathway_name_en,
  art_sub_pathway_name_ar,
  literary_language,
  institution_ref_number,
  institution_name,
  institution_type,
  school_region,
  coordinator_email,
  teacher_name,
  teacher_email,
  teacher_phone,
  participating_students_count,
  participating_students_names,
  participating_students_grades,
  participating_students_genders,
  participating_students_nationalities,
  general_proofreading_completed_at,
  literary_proofreading_completed_at,
  literary_publication_suitable,
  literary_updated_content,
  literary_proofreader_comment,
  evaluator_comment,
  management_artistic_rating,
  artistic_rating,
  disqualification_reason,
  coordinator_disqualification_reason,
  file_url,
  file_urls,
  artwork_file_urls,
  updated_artwork_file_urls
`;

function stringifyValue(value: any) {
  if (value === null || value === undefined) return "";

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function flattenRow(row: AnyRow, prefix = ""): AnyRow {
  const output: AnyRow = {};

  for (const [key, value] of Object.entries(row ?? {})) {
    const finalKey = prefix ? `${prefix}.${key}` : key;

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      Object.assign(output, flattenRow(value, finalKey));
    } else {
      output[finalKey] = stringifyValue(value);
    }
  }

  return output;
}

function autosizeWorksheet(worksheet: ExcelJS.Worksheet) {
  worksheet.columns.forEach((column) => {
    let maxLength = 12;

    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const length = String(cell.value ?? "").length;
      if (length > maxLength) maxLength = Math.min(length, 60);
    });

    column.width = maxLength + 2;
  });

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: "middle", wrapText: true };

  worksheet.eachRow((row) => {
    row.alignment = {
      vertical: "top",
      wrapText: true,
    };
  });
}

function addRowsSheet({
  workbook,
  sheetName,
  rows,
}: {
  workbook: ExcelJS.Workbook;
  sheetName: string;
  rows: AnyRow[];
}) {
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31));

  if (!rows.length) {
    worksheet.columns = [{ header: "Message", key: "message", width: 40 }];
    worksheet.addRow({ message: "No data available." });
    return;
  }

  const flattened = rows.map((row) => flattenRow(row));
  const keys = Array.from(
    new Set(flattened.flatMap((row) => Object.keys(row)))
  );

  worksheet.columns = keys.map((key) => ({
    header: key,
    key,
    width: 20,
  }));

  for (const row of flattened) {
    worksheet.addRow(row);
  }

  autosizeWorksheet(worksheet);
}

async function fetchPaged(
  table: string,
  select: string,
  options?: {
    eq?: [string, any][];
    order?: { column: string; ascending?: boolean };
    pageSize?: number;
    maxRows?: number;
  }
): Promise<AnyRow[]> {
  const pageSize = options?.pageSize ?? 250;
  const maxRows = options?.maxRows ?? Number.POSITIVE_INFINITY;
  let from = 0;
  const allRows: AnyRow[] = [];

  while (allRows.length < maxRows) {
    const remaining = maxRows - allRows.length;
    const effectivePageSize = Math.min(pageSize, remaining);

    let query = supabaseAdmin
      .from(table)
      .select(select)
      .range(from, from + effectivePageSize - 1);

    for (const [column, value] of options?.eq ?? []) {
      query = query.eq(column, value);
    }

    if (options?.order) {
      query = query.order(options.order.column, {
        ascending: options.order.ascending ?? true,
      });
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`${table} export query failed: ${error.message}`);
    }

    const rows = (data ?? []) as AnyRow[];
    allRows.push(...rows);

    if (rows.length < effectivePageSize) break;
    from += effectivePageSize;
  }

  return allRows;
}

async function fetchOptionalPaged(
  table: string,
  select: string,
  options?: {
    order?: { column: string; ascending?: boolean };
    pageSize?: number;
    maxRows?: number;
  }
): Promise<AnyRow[]> {
  try {
    return await fetchPaged(table, select, options);
  } catch (error) {
    console.warn(`Optional export table skipped: ${table}`, error);
    return [];
  }
}

async function fetchSubmissionRows() {
  return fetchPaged("submissions", SUBMISSION_SELECT, {
    order: { column: "id", ascending: true },
    pageSize: 100,
  });
}

function workbookWithSheet(sheetName: string, rows: AnyRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ADEK Frontliners Initiative";
  workbook.created = new Date();

  addRowsSheet({ workbook, sheetName, rows });

  return workbook.xlsx.writeBuffer().then((buffer) => Buffer.from(buffer));
}

export async function buildAllSubmissionsWorkbookBuffer() {
  const rows = await fetchSubmissionRows();
  return workbookWithSheet("All Submissions", rows);
}

export async function buildReadySubmissionsWorkbookBuffer() {
  const rows = (await fetchSubmissionRows()).filter(
    (row) => String(row.workflow_status ?? "") === "completed"
  );

  return workbookWithSheet("Ready Submissions", rows);
}

export async function buildSubmissionWorkbookBuffers() {
  const allRows = await fetchSubmissionRows();

  const allWorkbook = new ExcelJS.Workbook();
  allWorkbook.creator = "ADEK Frontliners Initiative";
  allWorkbook.created = new Date();
  addRowsSheet({ workbook: allWorkbook, sheetName: "All Submissions", rows: allRows });

  const readyRows = allRows.filter(
    (row) => String(row.workflow_status ?? "") === "completed"
  );

  const readyWorkbook = new ExcelJS.Workbook();
  readyWorkbook.creator = "ADEK Frontliners Initiative";
  readyWorkbook.created = new Date();
  addRowsSheet({ workbook: readyWorkbook, sheetName: "Ready Submissions", rows: readyRows });

  const allBuffer = await allWorkbook.xlsx.writeBuffer();
  const readyBuffer = await readyWorkbook.xlsx.writeBuffer();

  return {
    allSubmissionsBuffer: Buffer.from(allBuffer),
    readySubmissionsBuffer: Buffer.from(readyBuffer),
  };
}

export async function buildActivityLogWorkbookBuffer() {
  const [auditLogs, assignments, comments] = await Promise.all([
    fetchOptionalPaged(
      "audit_logs",
      `id,actor_id,action,entity_type,entity_id,before,after,created_at,actor:profiles!audit_logs_actor_id_fkey(id,full_name,email,role)`,
      {
        order: { column: "created_at", ascending: false },
        pageSize: 250,
        maxRows: 5000,
      }
    ),

    fetchOptionalPaged(
      "assignments",
      `
      id,
      submission_id,
      phase,
      status,
      decision,
      proofreader_type,
      assigned_to,
      assigned_by,
      requested_by_user_id,
      return_to_user_id,
      correction_reason,
      correction_notes,
      correction_source_phase,
      created_at,
      updated_at,
      completed_at,
      assigned_user:profiles!assignments_assigned_to_fkey(id,full_name,email,role,proofreader_type),
      submissions(id,reference_id,artwork_title_en,workflow_status)
      `,
      {
        order: { column: "created_at", ascending: false },
        pageSize: 250,
        maxRows: 10000,
      }
    ),

    fetchOptionalPaged(
      "comments",
      `id,submission_id,author_id,body,created_at,author:profiles!comments_author_id_fkey(id,full_name,email,role)`,
      {
        order: { column: "created_at", ascending: false },
        pageSize: 250,
        maxRows: 5000,
      }
    ),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ADEK Frontliners Initiative";
  workbook.created = new Date();

  addRowsSheet({ workbook, sheetName: "Audit Logs Latest 5000", rows: auditLogs });
  addRowsSheet({ workbook, sheetName: "Assignments Latest 10000", rows: assignments });
  addRowsSheet({ workbook, sheetName: "Comments Latest 5000", rows: comments });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
