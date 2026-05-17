import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  uploadMultipleUpdatedArtworksToDrive,
  uploadUpdatedArtworkToDrive,
} from "@/lib/google-drive";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectWithRefresh(req: Request, redirectTo: string) {
  const url = new URL(redirectTo || "/", req.url);
  url.searchParams.set("refresh", Date.now().toString());

  return NextResponse.redirect(url, {
    status: 303,
  });
}

function jsonError(message: string, status = 500) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    {
      status,
    }
  );
}

function sanitizeFileName(value: string) {
  return String(value || "updated-artwork")
    .trim()
    .replace(/[\\/:*?"<>|#{}%~&]/g, "-")
    .replace(/\s+/g, "-");
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(["coordinator", "admin"]);

    const form = await req.formData();

    const submissionId = String(form.get("submission_id") ?? "");
    const redirectTo = String(form.get("redirect_to") ?? "/");

    const files = form
      .getAll("updated_artwork_file")
      .filter((file): file is File => file instanceof File && file.size > 0);

    if (!submissionId) {
      return jsonError("Missing submission_id.", 400);
    }

    if (!files.length) {
      return jsonError("Missing updated artwork file.", 400);
    }

    const { data: submission, error: submissionError } = await supabaseAdmin
      .from("submissions")
      .select("id,reference_id,artwork_title_en")
      .eq("id", submissionId)
      .single();

    if (submissionError || !submission) {
      throw new Error(
        `Submission lookup failed: ${
          submissionError?.message ?? "Submission not found."
        }`
      );
    }

    const referenceId =
      sanitizeFileName(submission.reference_id) ||
      sanitizeFileName(submission.artwork_title_en) ||
      submission.id;

    const preparedFiles = await Promise.all(
      files.map(async (file) => ({
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        buffer: Buffer.from(await file.arrayBuffer()),
      }))
    );

    if (preparedFiles.length === 1) {
      const file = preparedFiles[0];

      const uploadedFile = await uploadUpdatedArtworkToDrive({
        referenceId,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        buffer: file.buffer,
      });

      const { error: insertError } = await supabaseAdmin
        .from("updated_artwork_files")
        .insert({
          submission_id: submissionId,
          uploaded_by: user.id,
          google_file_id: uploadedFile.id,
          google_file_url: uploadedFile.webViewLink,
          file_name: uploadedFile.name,
          original_file_name: file.originalFilename,
          mime_type: file.mimeType,
          file_size: file.fileSize,
        });

      if (insertError) {
        throw new Error(
          `Updated artwork file record insert failed: ${insertError.message}`
        );
      }

      const { error: updateError } = await supabaseAdmin
        .from("submissions")
        .update({
          updated_artwork_file_id: uploadedFile.id,
          updated_artwork_file_url: uploadedFile.webViewLink,
          updated_artwork_file_name: uploadedFile.name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", submissionId);

      if (updateError) {
        throw new Error(
          `Submission updated artwork update failed: ${updateError.message}`
        );
      }

      await audit({
        actorId: user.id,
        action: "updated_artwork_uploaded",
        entityType: "submission",
        entityId: submissionId,
        after: {
          mode: "single_file",
          google_file_id: uploadedFile.id,
          google_file_url: uploadedFile.webViewLink,
          file_name: uploadedFile.name,
          original_file_name: file.originalFilename,
        },
      });

      return redirectWithRefresh(req, redirectTo);
    }

    const uploaded = await uploadMultipleUpdatedArtworksToDrive({
      referenceId,
      files: preparedFiles.map((file) => ({
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        buffer: file.buffer,
      })),
    });

    const insertRows = uploaded.files.map((uploadedFile, index) => ({
      submission_id: submissionId,
      uploaded_by: user.id,
      google_file_id: uploadedFile.id,
      google_file_url: uploadedFile.webViewLink,
      file_name: uploadedFile.name,
      original_file_name: preparedFiles[index]?.originalFilename ?? uploadedFile.name,
      mime_type: preparedFiles[index]?.mimeType ?? "application/octet-stream",
      file_size: preparedFiles[index]?.fileSize ?? null,
    }));

    const { error: insertError } = await supabaseAdmin
      .from("updated_artwork_files")
      .insert(insertRows);

    if (insertError) {
      throw new Error(
        `Updated artwork file records insert failed: ${insertError.message}`
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("submissions")
      .update({
        updated_artwork_file_id: uploaded.folder.id,
        updated_artwork_file_url: uploaded.folder.webViewLink,
        updated_artwork_file_name: uploaded.folder.name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    if (updateError) {
      throw new Error(
        `Submission updated artwork folder update failed: ${updateError.message}`
      );
    }

    await audit({
      actorId: user.id,
      action: "updated_artworks_uploaded",
      entityType: "submission",
      entityId: submissionId,
      after: {
        mode: "multiple_files",
        folder_id: uploaded.folder.id,
        folder_url: uploaded.folder.webViewLink,
        folder_name: uploaded.folder.name,
        files: uploaded.files,
      },
    });

    return redirectWithRefresh(req, redirectTo);
  } catch (error: any) {
    console.error("Updated artwork upload failed:", error);

    return jsonError(
      error.message ?? "Updated artwork upload failed.",
      error.message === "FORBIDDEN" || error.message === "UNAUTHENTICATED"
        ? 403
        : 500
    );
  }
}