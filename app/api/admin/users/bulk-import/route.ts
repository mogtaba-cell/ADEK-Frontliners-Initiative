import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireUser, hashPassword } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedRoles = new Set([
  "admin",
  "coordinator",
  "evaluator",
  "management",
  "proofreader",
  "reviewer",
  "adek_hq",
]);

function getCell(row: Record<string, any>, names: string[]) {
  for (const name of names) {
    const value = row[name];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function normalizeBoolean(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();

  if (!text) return true;

  if (["true", "yes", "y", "1", "active", "enabled"].includes(text)) {
    return true;
  }

  if (["false", "no", "n", "0", "inactive", "disabled"].includes(text)) {
    return false;
  }

  return true;
}

function normalizeProofreaderType(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();

  if (!text) return "general";

  if (text === "general") return "general";
  if (text === "literary") return "literary_arabic";
  if (["arabic", "arabic_literary", "literary-arabic", "literary_arabic"].includes(text)) {
    return "literary_arabic";
  }
  if (
    [
      "english",
      "english_other",
      "english_others",
      "english_or_other",
      "english_or_others",
      "english/other",
      "english/others",
      "literary_english",
      "literary-english",
      "literary_english_or_others",
    ].includes(text)
  ) {
    return "literary_english_or_others";
  }

  return null;
}

function readRowsFromWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
  });

  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("The uploaded file does not contain any sheets.");
  }

  const sheet = workbook.Sheets[firstSheetName];

  return XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: "",
    raw: false,
  });
}

export async function POST(req: Request) {
  try {
    const actor = await requireUser(["admin"]);
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Missing file." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = readRowsFromWorkbook(buffer);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    const errors: {
      row: number;
      email?: string | null;
      message: string;
    }[] = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNumber = index + 2;

      const fullName = getCell(row, ["full_name", "Full Name", "name", "Name"]);
      const email = getCell(row, ["email", "Email"]).toLowerCase();
      const usernameRaw = getCell(row, ["username", "Username"]);
      const role = getCell(row, ["role", "Role"]).toLowerCase();
      const proofreaderTypeRaw = getCell(row, ["proofreader_type", "Proofreader Type", "proofreaderType"]).toLowerCase();
      const proofreaderType = role === "proofreader" ? normalizeProofreaderType(proofreaderTypeRaw) : null;
      const temporaryPassword = getCell(row, [
        "temp_password",
        "temporary_password",
        "password",
        "Password",
        "Temporary Password",
      ]);
      const isActive = normalizeBoolean(
        getCell(row, ["is_active", "active", "Active", "Is Active"])
      );

      if (!fullName) {
        skipped++;
        errors.push({
          row: rowNumber,
          email,
          message: "Missing full_name.",
        });
        continue;
      }

      if (!email) {
        skipped++;
        errors.push({
          row: rowNumber,
          email,
          message: "Missing email/username.",
        });
        continue;
      }

      if (!role || !allowedRoles.has(role)) {
        skipped++;
        errors.push({
          row: rowNumber,
          email,
          message:
            "Invalid role. Allowed roles: admin, coordinator, evaluator, management, proofreader, reviewer, adek_hq.",
        });
        continue;
      }

      if (role === "proofreader" && !proofreaderType) {
        skipped++;
        errors.push({
          row: rowNumber,
          email,
          message:
            "Invalid proofreader_type. Use general, literary_arabic, or literary_english_or_others.",
        });
        continue;
      }

      const { data: existing, error: existingError } = await supabaseAdmin
        .from("profiles")
        .select("id,email,password_hash")
        .eq("email", email)
        .maybeSingle();

      if (existingError) {
        skipped++;
        errors.push({
          row: rowNumber,
          email,
          message: existingError.message,
        });
        continue;
      }

      if (!existing && !temporaryPassword) {
        skipped++;
        errors.push({
          row: rowNumber,
          email,
          message: "Missing temp_password for new user.",
        });
        continue;
      }

      const payload: Record<string, any> = {
        email,
        username: usernameRaw || email.split("@")[0],
        full_name: fullName,
        role,
        proofreader_type: proofreaderType,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      };

      if (temporaryPassword) {
        payload.password_hash = await hashPassword(temporaryPassword);
      }

      const { data: saved, error: upsertError } = await supabaseAdmin
        .from("profiles")
        .upsert(payload, {
          onConflict: "email",
        })
        .select("id,email,role")
        .single();

      if (upsertError) {
        skipped++;
        errors.push({
          row: rowNumber,
          email,
          message: upsertError.message,
        });
        continue;
      }

      if (existing) {
        updated++;
      } else {
        created++;
      }

      await audit({
        actorId: actor.id,
        action: existing ? "user_bulk_updated" : "user_bulk_created",
        entityType: "profile",
        entityId: saved.id,
        after: {
          email: saved.email,
          role: saved.role,
          imported_from_file: file.name,
        },
      });
    }

    await audit({
      actorId: actor.id,
      action: "users_bulk_import_completed",
      entityType: "profile",
      entityId: file.name,
      after: {
        file_name: file.name,
        total_rows: rows.length,
        created,
        updated,
        skipped,
        errors: errors.length,
      },
    });

    return NextResponse.json({
      ok: true,
      totalRows: rows.length,
      created,
      updated,
      skipped,
      errors,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message ?? "Bulk user import failed.",
      },
      {
        status:
          error.message === "FORBIDDEN" || error.message === "UNAUTHENTICATED"
            ? 403
            : 500,
      }
    );
  }
}