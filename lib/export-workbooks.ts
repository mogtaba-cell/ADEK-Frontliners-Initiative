import "server-only";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type AnyRow = Record<string, any>;

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
      if (length > maxLength) maxLength = Math.min(length, 70);
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
  }
): Promise<AnyRow[]> {
  // Keep pages intentionally small. Some export rows are wide because submissions
  // include imported raw_data JSON, and larger PostgREST pages can hit the
  // database statement timeout even when the total row count is modest.
  const pageSize = options?.pageSize ?? 250;
  let from = 0;
  const allRows: AnyRow[] = [];

  while (true) {
    let query = supabaseAdmin
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);

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

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

async function fetchOptionalPaged(
  table: string,
  select: string,
  options?: {
    order?: { column: string; ascending?: boolean };
    pageSize?: number;
  }
): Promise<AnyRow[]> {
  try {
    return await fetchPaged(table, select, options);
  } catch (error) {
    console.warn(`Optional export table skipped: ${table}`, error);
    return [];
  }
}

function groupAssignmentsBySubmission(assignments: AnyRow[]) {
  const grouped: Record<string, AnyRow[]> = {};

  for (const assignment of assignments) {
    const submissionId = assignment.submission_id;
    if (!submissionId) continue;

    if (!grouped[submissionId]) grouped[submissionId] = [];
    grouped[submissionId].push(assignment);
  }

  return grouped;
}

function groupEvaluationsBySubmission(evaluations: AnyRow[]) {
  const grouped: Record<string, AnyRow[]> = {};

  for (const evaluation of evaluations) {
    const submissionId = evaluation.submission_id;
    if (!submissionId) continue;

    if (!grouped[submissionId]) grouped[submissionId] = [];
    grouped[submissionId].push(evaluation);
  }

  return grouped;
}

function summarizeAssignments(assignments: AnyRow[]) {
  if (!assignments?.length) return "";

  return assignments
    .map((assignment) => {
      const user =
        assignment.assigned_user?.full_name ??
        assignment.profiles?.full_name ??
        assignment.assigned_to ??
        "Unknown user";

      return [
        assignment.phase,
        assignment.status,
        assignment.decision ? `decision=${assignment.decision}` : "",
        assignment.correction_reason
          ? `reason=${assignment.correction_reason}`
          : "",
        `assigned_to=${user}`,
        assignment.completed_at ? `completed_at=${assignment.completed_at}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");
}

function summarizeEvaluations(evaluations: AnyRow[]) {
  if (!evaluations?.length) return "";

  return evaluations
    .map((evaluation) =>
      [
        `decision=${evaluation.decision ?? ""}`,
        `cultural=${evaluation.cultural_authenticity ?? ""}`,
        `artistic=${evaluation.artistic_excellence ?? ""}`,
        `ethical=${evaluation.ethical_public_appropriateness ?? ""}`,
        evaluation.evaluator_id ? `evaluator=${evaluation.evaluator_id}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    )
    .join("\n");
}

async function buildSubmissionExportRows(): Promise<AnyRow[]> {
  const [submissions, assignments, evaluations] = await Promise.all([
    fetchPaged("submissions", "*", {
      // Use the primary-key order for export pagination. Ordering wide rows by
      // updated_at can force an expensive sort and has caused Supabase statement
      // timeouts during full exports.
      order: { column: "id", ascending: true },
      pageSize: 100,
    }),

    fetchOptionalPaged(
      "assignments",
      `
      *,
      assigned_user:profiles!assignments_assigned_to_fkey(id,full_name,email,role,proofreader_type),
      requested_by_user:profiles!assignments_requested_by_user_id_fkey(id,full_name,email,role,proofreader_type),
      return_to_user:profiles!assignments_return_to_user_id_fkey(id,full_name,email,role,proofreader_type)
      `,
      {
        order: { column: "created_at", ascending: true },
        pageSize: 250,
      }
    ),

    fetchOptionalPaged("evaluations", "*", {
      order: { column: "id", ascending: true },
      pageSize: 250,
    }),
  ]);

  const assignmentsBySubmission = groupAssignmentsBySubmission(assignments);
  const evaluationsBySubmission = groupEvaluationsBySubmission(evaluations);

  return submissions.map((submission) => ({
    ...submission,
    task_history_summary: summarizeAssignments(
      assignmentsBySubmission[submission.id] ?? []
    ),
    evaluation_summary: summarizeEvaluations(
      evaluationsBySubmission[submission.id] ?? []
    ),
  }));
}

export async function buildAllSubmissionsWorkbookBuffer() {
  const rows: AnyRow[] = await buildSubmissionExportRows();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ADEK Frontliners Initiative";
  workbook.created = new Date();

  addRowsSheet({
    workbook,
    sheetName: "All Submissions",
    rows,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildReadySubmissionsWorkbookBuffer() {
  const allRows: AnyRow[] = await buildSubmissionExportRows();

  const rows = allRows.filter(
    (row) => String(row["workflow_status"] ?? "") === "completed"
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ADEK Frontliners Initiative";
  workbook.created = new Date();

  addRowsSheet({
    workbook,
    sheetName: "Ready Submissions",
    rows,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildSubmissionWorkbookBuffers() {
  const allRows: AnyRow[] = await buildSubmissionExportRows();

  const allWorkbook = new ExcelJS.Workbook();
  allWorkbook.creator = "ADEK Frontliners Initiative";
  allWorkbook.created = new Date();

  addRowsSheet({
    workbook: allWorkbook,
    sheetName: "All Submissions",
    rows: allRows,
  });

  const readyRows = allRows.filter(
    (row) => String(row["workflow_status"] ?? "") === "completed"
  );

  const readyWorkbook = new ExcelJS.Workbook();
  readyWorkbook.creator = "ADEK Frontliners Initiative";
  readyWorkbook.created = new Date();

  addRowsSheet({
    workbook: readyWorkbook,
    sheetName: "Ready Submissions",
    rows: readyRows,
  });

  // Write the large workbook first, then the smaller ready workbook. Writing both
  // at the same time can spike memory/CPU and increase serverless timeout risk.
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
      `
      *,
      actor:profiles!audit_logs_actor_id_fkey(id,full_name,email,role)
      `,
      {
        order: { column: "created_at", ascending: false },
      }
    ),

    fetchOptionalPaged(
      "assignments",
      `
      *,
      assigned_user:profiles!assignments_assigned_to_fkey(id,full_name,email,role,proofreader_type),
      requested_by_user:profiles!assignments_requested_by_user_id_fkey(id,full_name,email,role,proofreader_type),
      submissions(id,reference_id,artwork_title_en,workflow_status)
      `,
      {
        order: { column: "created_at", ascending: false },
      }
    ),

    fetchOptionalPaged(
      "comments",
      `
      *,
      author:profiles!comments_author_id_fkey(id,full_name,email,role)
      `,
      {
        order: { column: "created_at", ascending: false },
      }
    ),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ADEK Frontliners Initiative";
  workbook.created = new Date();

  addRowsSheet({
    workbook,
    sheetName: "Audit Logs",
    rows: auditLogs,
  });

  addRowsSheet({
    workbook,
    sheetName: "Assignments",
    rows: assignments,
  });

  addRowsSheet({
    workbook,
    sheetName: "Comments",
    rows: comments,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}