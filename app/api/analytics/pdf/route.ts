import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  buildAnalyticsDashboardPdfBuffer,
  filtersFromSearchParams,
} from "@/lib/analytics-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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