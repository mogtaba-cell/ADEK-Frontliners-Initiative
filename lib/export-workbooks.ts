import "server-only";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type AnyRow = Record<string, any>;

type FetchOptions = {
  eq?: [string, any][];
  order?: { column: string; ascending?: boolean };
  pageSize?: number;
  maxRows?: number;
};

// Keep this list intentionally broad, but never trust it blindly. Existing
// deployments have slightly different submissions schemas because some columns
// were added during live fixes. fetchPagedResilient() removes any column that
// does not exist in the connected database and retries, so exports do not fail
// because of schema differences.
const PREFERRED_SUBMISSION_COLUMNS = [
  "id",
  "reference_id",
  "created_at",
  "updated_at",
  "registration_id",
  "registration_status",
  "submission_date",
  "submission_date_value",
  "workflow_status",
  "evaluation_decision",
  "management_decision",
  "reviewer_decision",
  "completed_at",
  "art_pathway_name_en",
  "art_pathway_name_ar",
  "art_sub_pathway_name_en",
  "art_sub_pathway_name_ar",
  "institution_type",
  "school_region",
  "institution_ref_number",
  "institution_name",
  "art_link",
  "artwork_title_en",
  "artwork_title_ar",
  "description_en",
  "description_ar",
  "participating_students_esis_numbers",
  "participating_students_names",
  "participating_students_grades",
  "participating_students_genders",
  "participating_students_nationalities",

  // Narrative / artwork fields edited by proofreaders/reviewers.
  "influence_idea_source",
  "most_enjoyable_part",
  "focused_elements",
  "group_name",

  // Evaluation fields.
  "evaluator_comment",
  "evaluator_file_quality_clear",
  "cultural_authenticity",
  "artistic_excellence",
  "ethical_public_appropriateness",
  "artistic_rating",
  "management_artistic_rating",
  "categorized_pathway",
  "categorization_completed_at",
  "artistic_ranking",
  "artistic_quality_creativity_score",
  "initiative_relation_score",
  "age_appropriateness_score",
  "artistic_rubric_total_score",
  "artistic_rubric_comment",
  "artistic_ranking_completed_at",
  "disqualification_reason",
  "coordinator_disqualification_reason",

  // Literary / proofreading fields.
  "literary_language",
  "literary_publication_suitable",
  "literary_updated_content",
  "literary_proofreader_comment",
  "general_proofreading_completed_at",
  "literary_proofreading_completed_at",
  "literary_management_approved_at",

  // Updated artwork fields.
  "updated_artwork_file_id",
  "updated_artwork_file_url",
  "updated_artwork_file_name",

  // Required for export-only fallback fields that are not normal columns.
  "raw_data",
];

const ACTIVITY_MAX_ROWS = {
  auditLogs: 5000,
  assignments: 10000,
  comments: 5000,
};

function isBlankLike(value: any) {
  if (value === null || value === undefined) return true;

  const text = String(value).trim();

  return (
    text === "" ||
    text.toLowerCase() === "null" ||
    text.toLowerCase() === "undefined" ||
    text.toLowerCase() === "nan"
  );
}

function cleanExportValue(value: any) {
  if (isBlankLike(value)) return "";

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return value;
}

function stringifyValue(value: any) {
  const cleaned = cleanExportValue(value);

  if (cleaned === null || cleaned === undefined) return "";

  if (typeof cleaned === "object") {
    try {
      return JSON.stringify(cleaned);
    } catch {
      return String(cleaned);
    }
  }

  return String(cleaned);
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
  const keys = Array.from(new Set(flattened.flatMap((row) => Object.keys(row))));

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

function selectFromColumns(columns: string[]) {
  return columns.join(",");
}

function missingColumnFromMessage(message: string) {
  return (
    message.match(/column\s+(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s+does\s+not\s+exist/i)?.[1] ??
    message.match(/could\s+not\s+find\s+the\s+['\"]([^'\"]+)['\"]\s+column/i)?.[1] ??
    null
  );
}

async function fetchPaged(
  table: string,
  select: string,
  options?: FetchOptions
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

async function fetchPagedResilient(
  table: string,
  preferredColumns: string[],
  options?: FetchOptions
): Promise<AnyRow[]> {
  let columns = Array.from(new Set(preferredColumns));
  const removedColumns: string[] = [];

  while (columns.length) {
    try {
      const rows = await fetchPaged(table, selectFromColumns(columns), options);

      if (removedColumns.length) {
        console.warn(
          `${table} export skipped missing columns: ${removedColumns.join(", ")}`
        );
      }

      return rows;
    } catch (error: any) {
      const message = String(error?.message ?? "");
      const missingColumn = missingColumnFromMessage(message);

      if (!missingColumn || !columns.includes(missingColumn)) {
        throw error;
      }

      columns = columns.filter((column) => column !== missingColumn);
      removedColumns.push(missingColumn);
    }
  }

  // Extremely defensive fallback: this should never run, but keeps export from
  // failing with an empty custom column list.
  return fetchPaged(table, "*", options);
}

async function fetchOptionalPaged(
  table: string,
  select: string,
  options?: FetchOptions
): Promise<AnyRow[]> {
  try {
    return await fetchPaged(table, select, options);
  } catch (error) {
    console.warn(`Optional export table skipped: ${table}`, error);
    return [];
  }
}

function rawValue(rawData: any, ...keys: string[]) {
  if (!rawData || typeof rawData !== "object") return "";

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(rawData, key)) {
      const value = cleanExportValue(rawData[key]);
      if (!isBlankLike(value)) return value;
    }
  }

  return "";
}

function firstNonBlank(...values: any[]) {
  for (const value of values) {
    const cleaned = cleanExportValue(value);
    if (!isBlankLike(cleaned)) return cleaned;
  }

  return "";
}

function artisticRatingArabic(value: any) {
  const rating = String(value ?? "").trim().toLowerCase();

  const map: Record<string, string> = {
    excellent: "ممتاز",
    good: "جيد",
    medium: "متوسط",
    weak: "ضعيف",
  };

  return map[rating] ?? "";
}

function addReadySubmissionExportColumns(row: AnyRow) {
  const rawData = row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};

  const rating =
    firstNonBlank(row.artistic_rating, row.management_artistic_rating) || "";

  const enriched: AnyRow = {
    ...row,

    // Arabic rating required by the final Ready Submissions template.
    artistic_rating_ar: artisticRatingArabic(rating),

    // These three should use the proofreader/reviewer-edited columns first,
    // then fall back to original imported raw_data if the edited column is blank.
    "Did anyone or anything influence your idea (family, artist, place)?":
      firstNonBlank(
        row.influence_idea_source,
        rawValue(
          rawData,
          "Did anyone or anything influence your idea (family, artist, place)?"
        )
      ),

    "What was the most enjoyable part of creating your work?":
      firstNonBlank(
        row.most_enjoyable_part,
        rawValue(rawData, "What was the most enjoyable part of creating your work?")
      ),

    "What elements did you focus on, and why?":
      firstNonBlank(
        row.focused_elements,
        rawValue(rawData, "What elements did you focus on, and why?")
      ),

    // Imported registration/artwork fields that are not normal submission columns.
    GroupName: firstNonBlank(row.group_name, rawValue(rawData, "GroupName")),
    NumberOfStudents: rawValue(rawData, "NumberOfStudents"),
    participating_students_names_arabic: rawValue(
      rawData,
      "ParticipatingStudentsNamesAr"
    ),
    RegistrationType: rawValue(rawData, "RegistrationType"),
    ArtWorkMedium: rawValue(rawData, "ArtWorkMedium"),
    Length: rawValue(rawData, "Length"),
    Breadth: rawValue(rawData, "Breadth"),
    Width: rawValue(rawData, "Width"),
  };

  // raw_data is used internally for fallback values, but it should not appear as
  // a huge JSON column or raw_data.* columns in the exported Excel sheets.
  delete enriched.raw_data;

  return enriched;
}

function prepareSubmissionRowsForExport(rows: AnyRow[]) {
  return rows.map(addReadySubmissionExportColumns);
}

async function fetchSubmissionRows() {
  const rows = await fetchPagedResilient(
    "submissions",
    PREFERRED_SUBMISSION_COLUMNS,
    {
      order: { column: "id", ascending: true },
      pageSize: 200,
    }
  );

  return prepareSubmissionRowsForExport(rows);
}

async function workbookWithSheet(sheetName: string, rows: AnyRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ADEK Frontliners Initiative";
  workbook.created = new Date();

  addRowsSheet({ workbook, sheetName, rows });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
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

  const allSubmissionsBuffer = await workbookWithSheet(
    "All Submissions",
    allRows
  );

  const readyRows = allRows.filter(
    (row) => String(row.workflow_status ?? "") === "completed"
  );

  const readySubmissionsBuffer = await workbookWithSheet(
    "Ready Submissions",
    readyRows
  );

  return {
    allSubmissionsBuffer,
    readySubmissionsBuffer,
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
        pageSize: 500,
        maxRows: ACTIVITY_MAX_ROWS.auditLogs,
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
        pageSize: 500,
        maxRows: ACTIVITY_MAX_ROWS.assignments,
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
        pageSize: 500,
        maxRows: ACTIVITY_MAX_ROWS.comments,
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