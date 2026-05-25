import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Automatic Google Drive export is intentionally disabled.
 *
 * Reason:
 * The automatic export builds PDFs/XLSX files inside Vercel Functions.
 * On the Hobby plan, that can consume Fluid Active CPU and risk pausing the app.
 *
 * Manual/local replacement:
 * Use scripts/export-ready-submissions-local.ts from your PC for urgent exports.
 *
 * To re-enable in the future:
 * Restore the previous implementation from git history, or move the export job
 * fully outside Vercel into a GitHub Actions Node script that connects directly
 * to Supabase and Google Drive.
 */

function disabledResponse() {
  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      route: "/api/cron/daily-export",
      message:
        "Automatic export is disabled to protect Vercel CPU usage. Use the local export script instead.",
    },
    { status: 503 }
  );
}

export async function GET() {
  return disabledResponse();
}

export async function POST() {
  return disabledResponse();
}