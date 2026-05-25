import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  buildAnalyticsDashboardPdfBuffer,
  filtersFromSearchParams,
} from "@/lib/analytics-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANALYTICS_PDF_PASSWORD =
  process.env.ANALYTICS_PDF_PASSWORD ||
  process.env.MANUAL_EXPORT_PASSWORD ||
  "726642";

function validateAnalyticsPdfPassword(req: Request) {
  const submittedPassword =
    req.headers.get("x-analytics-pdf-password")?.trim() ?? "";

  if (!submittedPassword || submittedPassword !== ANALYTICS_PDF_PASSWORD) {
    throw new Error("INVALID_ANALYTICS_PDF_PASSWORD");
  }
}

export async function GET(req: Request) {
  try {
    await requireUser([
      "admin",
      "management",
      "coordinator",
      "evaluator",
      "proofreader",
      "reviewer",
      "adek_hq",
    ]);

    validateAnalyticsPdfPassword(req);

    const url = new URL(req.url);
    const filters = filtersFromSearchParams(url.searchParams);
    const buffer = await buildAnalyticsDashboardPdfBuffer(filters);

    const filename = `adek-frontliners-analytics-${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("Analytics PDF export failed:", error);

    if (error.message === "INVALID_ANALYTICS_PDF_PASSWORD") {
      return NextResponse.json(
        {
          error: "Invalid Analytics PDF password.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        error: error.message ?? "Failed to export analytics PDF.",
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