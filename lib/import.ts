import "server-only";
import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { audit } from "@/lib/audit";
import { assignAdekAfterImport } from "@/lib/assignment";

const mapStatus = (s: unknown) => {
  const v = String(s ?? "").trim().toLowerCase();

  if (["programsubmitted", "submitted"].includes(v)) return "Submitted";
  if (["programdraft", "draft"].includes(v)) return "Draft";
  if (["programdeactivated", "deactivated", "withdrawn"].includes(v)) {
    return "Deactivated";
  }

  return v ? String(s) : null;
};

function rawVal(row: any, names: string[]) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && String(row[n]).trim() !== "") {
      return row[n];
    }
  }

  return null;
}

function val(row: any, names: string[]) {
  const value = rawVal(row, names);

  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).trim();
}

function parseSubmissionDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${mm}-${dd}`;
    }
  }

  const raw = String(value).trim();

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const parsed = XLSX.SSF.parse_date_code(Number(raw));

    if (parsed) {
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${mm}-${dd}`;
    }
  }

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);

  const parts = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);

  if (parts) {
    const [, first, second, yyyy] = parts;
    const day = Number(first);
    const month = Number(second);
    const candidate = new Date(Number(yyyy), month - 1, day);

    if (!Number.isNaN(candidate.getTime())) {
      return candidate.toISOString().slice(0, 10);
    }
  }

  return raw;
}

export function normalizeGrade(value: unknown) {
  const raw = String(value ?? "").trim();

  if (!raw) return null;

  const normalizedSpaces = raw.replace(/\s+/g, " ");

  const gradeMatch = normalizedSpaces.match(/grade\s*([0-9]{1,2})/i);

  if (gradeMatch) {
    return `Grade ${Number(gradeMatch[1])}`;
  }

  const shortGradeMatch = normalizedSpaces.match(/^g\s*([0-9]{1,2})$/i);

  if (shortGradeMatch) {
    return `Grade ${Number(shortGradeMatch[1])}`;
  }

  return normalizedSpaces;
}

function normalizeGradeList(value: unknown) {
  const raw = String(value ?? "").trim();

  if (!raw) return null;

  return raw
    .split(";")
    .map((item) => normalizeGrade(item))
    .filter(Boolean)
    .join("; ");
}

async function updateProgress(batchId: string, updates: Record<string, any>) {
  await supabaseAdmin.from("import_batches").update(updates).eq("id", batchId);
}

export async function createImportBatch(fileName: string, actorId: string) {
  const batchIns = await supabaseAdmin
    .from("import_batches")
    .insert({
      file_name: fileName,
      imported_by: actorId,
      status: "queued",
      current_step: "Upload received",
      rows_total: 0,
      rows_processed: 0,
      rows_inserted: 0,
      rows_updated: 0,
      rows_skipped: 0,
    })
    .select("id")
    .single();

  if (batchIns.error) throw batchIns.error;

  return batchIns.data.id as string;
}

export async function getImportBatch(batchId: string) {
  const { data, error } = await supabaseAdmin
    .from("import_batches")
    .select(
      "id,file_name,status,current_step,rows_total,rows_processed,rows_inserted,rows_updated,rows_skipped,error_message,created_at,started_at,completed_at"
    )
    .eq("id", batchId)
    .single();

  if (error) throw error;

  const { count: errorCount } = await supabaseAdmin
    .from("import_errors")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", batchId);

  return {
    ...data,
    rows_errors: errorCount ?? 0,
  };
}

function buildSubmissionPayload(
  row: any,
  batchId: string,
  existingWorkflowStatus?: string | null
) {
  const reference_id = val(row, [
    "referenceId",
    "ReferenceId",
    "reference_id",
    "Reference ID",
  ]);

  const submissionDateRaw = rawVal(row, [
    "Submission date",
    "submission_date",
    "SubmittedOn",
  ]);

  const submissionDateValue = parseSubmissionDate(submissionDateRaw);

  const registrationStatus = mapStatus(
    val(row, ["RegistrationStatus ", "RegistrationStatus", "registration_status"])
  );

  const newWorkflowStatus =
    registrationStatus === "Submitted" ? "ready_for_adek" : "imported";

  return {
    reference_id,
    registration_id: val(row, ["RegistrationId", "registrationId"]),
    registration_status: registrationStatus,
    submission_date: submissionDateValue,
    submission_date_value: submissionDateValue,

    art_pathway_name_en: val(row, ["ArtPathwayNameEn", "Pathway"]),
    art_pathway_name_ar: val(row, ["ArtPathwayNameAr"]),
    art_sub_pathway_name_en: val(row, ["ArtSubPathwayNameEn"]),
    art_sub_pathway_name_ar: val(row, ["ArtSubPathwayNameAr"]),

    institution_type: val(row, ["InstitutionType", "School Type"]),
    school_region: val(row, ["SchoolRegion", "Region"]),
    institution_ref_number: val(row, ["InstitutionRefNumber"]),
    institution_name: val(row, ["InstitutionName", "School Name"]),

    art_link: val(row, ["ArtLink", "Artwork Link", "Source File"]),

    artwork_title_en: val(row, [
      "ArtWorkTitleEn",
      "ArtworkTitleEn",
      "Artwork Title En",
      "TitleEn",
      "English Title",
    ]),

    artwork_title_ar: val(row, [
      "ArtWorkTitleAr",
      "ArtworkTitleAr",
      "Artwork Title Ar",
      "TitleAr",
      "Arabic Title",
    ]),

    description_en: val(row, [
      "ArtWorkDescrEn",
      "ArtworkDescriptionEn",
      "DescriptionEn",
      "NarrativeEn",
      "English Description",
    ]),

    description_ar: val(row, [
      "ArtWorkDescrAr",
      "ArtworkDescriptionAr",
      "DescriptionAr",
      "NarrativeAr",
      "Arabic Description",
    ]),

    influence_idea_source: val(row, [
      "Did anyone or anything influence your idea (family, artist, place)?",
      "Did anyone or anything influence your idea",
    ]),

    most_enjoyable_part: val(row, [
      "What was the most enjoyable part of creating your work?",
      "Most enjoyable part",
    ]),

    focused_elements: val(row, [
      "What elements did you focus on, and why?",
      "What elements did you focus on",
    ]),

    group_name: val(row, [
      "GroupName",
      "Group Name",
      "group_name",
      "GroupNameEn",
    ]),

    participating_students_esis_numbers: val(row, [
      "ParticipatingStudentsESISNumbers",
      "ESIS",
    ]),

    participating_students_names: val(row, [
      "ParticipatingStudentsNamesEn",
      "ParticipatingStudentsNames",
      "StudentNames",
      "StudentsNames",
      "Student Names",
      "Student Name",
      "Student Full Name",
    ]),

    participating_students_grades: normalizeGradeList(
      val(row, ["ParticipatingStudentsGrades", "Grades"])
    ),

    participating_students_genders: val(row, [
      "ParticipatingStudentsGenders",
      "Gender",
    ]),

    participating_students_nationalities: val(row, [
      "ParticipatingStudentsNationalities",
      "Nationalities",
    ]),

    raw_data: row,
    last_import_batch_id: batchId,

    workflow_status: existingWorkflowStatus ?? newWorkflowStatus,
    updated_at: new Date().toISOString(),
  };
}

export async function processImportWorkbook(
  batchId: string,
  buffer: Buffer,
  fileName: string,
  actorId: string
) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let processed = 0;
  const errors: any[] = [];

  try {
    await updateProgress(batchId, {
      status: "processing",
      current_step: "Reading workbook",
      started_at: new Date().toISOString(),
    });

    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

    const sheetRows = workbook.SheetNames.map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[sheetName], {
        defval: null,
        raw: true,
      });

      return {
        sheetName,
        rows,
      };
    });

    const totalRows = sheetRows.reduce((sum, sheet) => sum + sheet.rows.length, 0);

    await updateProgress(batchId, {
      rows_total: totalRows,
      rows_processed: 0,
      current_step: "Validating rows",
    });

    for (const sheet of sheetRows) {
      for (let idx = 0; idx < sheet.rows.length; idx++) {
        const row = sheet.rows[idx];

        const reference_id = val(row, [
          "referenceId",
          "ReferenceId",
          "reference_id",
          "Reference ID",
        ]);

        if (!reference_id) {
          skipped++;
          processed++;

          errors.push({
            import_batch_id: batchId,
            row_number: idx + 2,
            reference_id: null,
            error_type: "missing_reference_id",
            error_message: "Missing referenceId",
          });

          await updateProgress(batchId, {
            rows_processed: processed,
            rows_inserted: inserted,
            rows_updated: updated,
            rows_skipped: skipped,
          });

          continue;
        }

        await updateProgress(batchId, {
          current_step: `Processing ${reference_id} (${processed + 1} of ${totalRows})`,
        });

        const existing = await supabaseAdmin
          .from("submissions")
          .select("id,reference_id,workflow_status")
          .eq("reference_id", reference_id)
          .maybeSingle();

        if (existing.error) throw existing.error;

        const payload = buildSubmissionPayload(
          row,
          batchId,
          existing.data?.workflow_status ?? null
        );

        const up = await supabaseAdmin
          .from("submissions")
          .upsert(payload, { onConflict: "reference_id" })
          .select("id")
          .single();

        if (up.error) {
          skipped++;
          processed++;

          errors.push({
            import_batch_id: batchId,
            row_number: idx + 2,
            reference_id,
            error_type: "upsert_failed",
            error_message: up.error.message,
          });

          await updateProgress(batchId, {
            rows_processed: processed,
            rows_inserted: inserted,
            rows_updated: updated,
            rows_skipped: skipped,
          });

          continue;
        }

        if (existing.data) {
          updated++;
        } else {
          inserted++;
        }

        await upsertSchool(payload);
        await upsertStudents(up.data.id, payload);

        if (payload.registration_status === "Submitted" && !existing.data) {
          try {
            await assignAdekAfterImport(up.data.id, actorId);
          } catch (assignmentError: any) {
            errors.push({
              import_batch_id: batchId,
              row_number: idx + 2,
              reference_id,
              error_type: "adek_assignment_failed",
              error_message: assignmentError?.message ?? "ADEK assignment failed",
            });
          }
        }

        processed++;

        await updateProgress(batchId, {
          rows_processed: processed,
          rows_inserted: inserted,
          rows_updated: updated,
          rows_skipped: skipped,
        });
      }
    }

    if (errors.length) {
      await supabaseAdmin.from("import_errors").insert(errors);
    }

    await updateProgress(batchId, {
      status: "completed",
      current_step: "Import completed",
      rows_processed: processed,
      rows_inserted: inserted,
      rows_updated: updated,
      rows_skipped: skipped,
      completed_at: new Date().toISOString(),
    });

    await audit({
      actorId,
      action: "import_completed",
      entityType: "import_batch",
      entityId: batchId,
      after: {
        fileName,
        inserted,
        updated,
        skipped,
        errors: errors.length,
      },
    });
  } catch (e: any) {
    await updateProgress(batchId, {
      status: "failed",
      current_step: "Import failed",
      error_message: e.message,
      completed_at: new Date().toISOString(),
    });

    await audit({
      actorId,
      action: "import_failed",
      entityType: "import_batch",
      entityId: batchId,
      after: {
        fileName,
        error: e.message,
      },
    });
  }
}

async function upsertSchool(p: any) {
  if (!p.institution_ref_number && !p.institution_name) return;

  await supabaseAdmin.from("schools").upsert(
    {
      institution_ref_number: p.institution_ref_number ?? p.institution_name,
      institution_name: p.institution_name,
      school_region: p.school_region,
      institution_type: p.institution_type,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "institution_ref_number",
    }
  );
}

async function upsertStudents(submissionId: string, p: any) {
  const esis = String(p.participating_students_esis_numbers ?? "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);

  const names = String(p.participating_students_names ?? "")
    .split(";")
    .map((x) => x.trim());

  const grades = String(p.participating_students_grades ?? "")
    .split(";")
    .map((x) => normalizeGrade(x))
    .filter(Boolean);

  const genders = String(p.participating_students_genders ?? "")
    .split(";")
    .map((x) => x.trim());

  const nationalities = String(p.participating_students_nationalities ?? "")
    .split(";")
    .map((x) => x.trim());

  const totalStudents = Math.max(esis.length, names.length, grades.length);

  for (let i = 0; i < totalStudents; i++) {
    const key =
      esis[i] ||
      `${names[i] ?? "unknown"}-${p.institution_ref_number ?? p.institution_name}-${
        grades[i] ?? ""
      }`;

    await supabaseAdmin.from("students").upsert(
      {
        student_key: key,
        esis_number: esis[i] || null,
        full_name: names[i] || null,
        grade: grades[i] || null,
        gender: genders[i] || null,
        nationality: nationalities[i] || null,
        institution_ref_number: p.institution_ref_number,
        submission_id: submissionId,
      },
      {
        onConflict: "student_key,submission_id",
      }
    );
  }
}

export async function importWorkbook(
  buffer: Buffer,
  fileName: string,
  actorId: string
) {
  const batchId = await createImportBatch(fileName, actorId);
  await processImportWorkbook(batchId, buffer, fileName, actorId);
  return getImportBatch(batchId);
}