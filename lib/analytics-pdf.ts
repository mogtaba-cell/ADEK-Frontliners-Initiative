import "server-only";
import { jsPDF } from "jspdf";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type AnyRow = Record<string, any>;

type ChartRow = {
  name: string;
  value: number;
  percentage?: number;
};

type UserProgressRow = {
  full_name: string;
  role: string;
  assigned: number;
  completed: number;
  remaining: number;
  completion_rate: number;
};

type AnalyticsFilters = {
  pathway?: string;
  subpathway?: string;
  schoolType?: string;
  region?: string;
  registrationStatus?: string;
  workflowStatus?: string;
};

type AnalyticsReport = {
  generatedAt: Date;
  filters: AnalyticsFilters;
  kpis: {
    totalSubmissions: number;
    totalEvaluated: number;
    totalSelected: number;
    totalProofread: number;
    totalReviewed: number;
    totalReady: number;
    uniqueStudents: number;
    uaeStudents: number;
    nonUaeStudents: number;
    usersTracked: number;
  };
  charts: {
    byPathway: ChartRow[];
    bySubpathway: ChartRow[];
    bySchoolType: ChartRow[];
    byRegion: ChartRow[];
    uniqueSchoolsByRegion: ChartRow[];
    uniqueSchoolsByType: ChartRow[];
    genderRows: ChartRow[];
    gradeRows: ChartRow[];
    cycleRows: ChartRow[];
    nationalityTable: ChartRow[];
    workflowStatus: ChartRow[];
    userProgress: UserProgressRow[];
  };
};

function pct(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 10000) / 100;
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitMultiValue(value: unknown) {
  const raw = cleanText(value);

  if (!raw) return [];

  return raw
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isUaeNationality(name: string) {
  const normalized = name.trim().toLowerCase();

  return [
    "uae",
    "u.a.e",
    "u.a.e.",
    "united arab emirates",
    "emirati",
    "emirates",
    "الإمارات",
    "الامارات",
    "الإمارات العربية المتحدة",
    "الامارات العربية المتحدة",
    "اماراتي",
    "إماراتي",
  ].some((term) => normalized.includes(term));
}

function normalizeNationality(value: unknown) {
  const text = cleanText(value);
  const normalized = text.toLowerCase();

  if (!text) return "Unknown";

  if (
    normalized === "uae" ||
    normalized === "u.a.e" ||
    normalized === "u.a.e." ||
    normalized.includes("united arab emirates") ||
    normalized.includes("emirati") ||
    normalized.includes("الإمارات") ||
    normalized.includes("الامارات")
  ) {
    return "UAE";
  }

  return text;
}

function normalizeGrade(value: unknown) {
  const raw = cleanText(value);

  if (!raw) return "Unknown";

  if (/kg|kindergarten|fs\s*1|fs\s*2/i.test(raw)) return "KG";

  const gradeMatch = raw.match(/grade\s*([0-9]{1,2})/i);
  if (gradeMatch) return `Grade ${Number(gradeMatch[1])}`;

  const shortMatch = raw.match(/\bg\s*([0-9]{1,2})\b/i);
  if (shortMatch) return `Grade ${Number(shortMatch[1])}`;

  return raw;
}

function cycleForGrade(value: unknown) {
  const grade = normalizeGrade(value);

  if (grade === "KG") return "Cycle 1";

  const match = grade.match(/Grade\s*([0-9]{1,2})/i);
  if (!match) return "Unspecified";

  const gradeNumber = Number(match[1]);

  if (gradeNumber <= 5) return "Cycle 1";
  if (gradeNumber <= 8) return "Cycle 2";
  return "Cycle 3";
}

function countRows(rows: AnyRow[], getter: (row: AnyRow) => unknown): ChartRow[] {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    const key = cleanText(getter(row)) || "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function countMultiRows(
  rows: AnyRow[],
  getter: (row: AnyRow) => unknown,
  normalizer?: (value: unknown) => string
): ChartRow[] {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    const parts = splitMultiValue(getter(row));

    if (!parts.length) {
      counts.Unknown = (counts.Unknown ?? 0) + 1;
      continue;
    }

    for (const part of parts) {
      const key = normalizer ? normalizer(part) : part;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

async function fetchSubmissions(filters: AnalyticsFilters) {
  const pageSize = 1000;
  let from = 0;
  const rows: AnyRow[] = [];

  while (true) {
    let query = supabaseAdmin
      .from("submissions")
      .select("*")
      .order("updated_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (filters.pathway) {
      query = query.eq("art_pathway_name_en", filters.pathway);
    }

    if (filters.subpathway) {
      query = query.eq("art_sub_pathway_name_en", filters.subpathway);
    }

    if (filters.schoolType) {
      query = query.eq("institution_type", filters.schoolType);
    }

    if (filters.region) {
      query = query.eq("school_region", filters.region);
    }

    if (filters.registrationStatus) {
      query = query.eq("registration_status", filters.registrationStatus);
    }

    if (filters.workflowStatus) {
      query = query.eq("workflow_status", filters.workflowStatus);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Analytics submissions query failed: ${error.message}`);
    }

    const pageRows = (data ?? []) as AnyRow[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function fetchOptionalRows(table: string, select = "*") {
  try {
    const pageSize = 1000;
    let from = 0;
    const rows: AnyRow[] = [];

    while (true) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select(select)
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const pageRows = (data ?? []) as AnyRow[];
      rows.push(...pageRows);

      if (pageRows.length < pageSize) break;
      from += pageSize;
    }

    return rows;
  } catch (error) {
    console.warn(`Optional analytics table skipped: ${table}`, error);
    return [];
  }
}

async function getLiveUserProgress(): Promise<UserProgressRow[]> {
  const [
    { data: users, error: usersError },
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id,full_name,role,is_active")
      .not("role", "in", "(admin,adek_hq)")
      .eq("is_active", true)
      .order("role", { ascending: true })
      .order("full_name", { ascending: true }),

    supabaseAdmin.from("assignments").select("assigned_to,status"),
  ]);

  if (usersError) {
    console.error("Live user progress users query failed:", usersError.message);
    return [];
  }

  if (assignmentsError) {
    console.error(
      "Live user progress assignments query failed:",
      assignmentsError.message
    );
    return [];
  }

  const progressMap = new Map<
    string,
    {
      assigned: number;
      completed: number;
    }
  >();

  for (const user of users ?? []) {
    progressMap.set(user.id, {
      assigned: 0,
      completed: 0,
    });
  }

  for (const assignment of assignments ?? []) {
    if (!assignment.assigned_to) continue;

    const current = progressMap.get(assignment.assigned_to);
    if (!current) continue;

    current.assigned += 1;

    if (assignment.status === "completed") {
      current.completed += 1;
    }
  }

  return (users ?? [])
    .map((user: any) => {
      const progress = progressMap.get(user.id) ?? {
        assigned: 0,
        completed: 0,
      };

      const remaining = Math.max(0, progress.assigned - progress.completed);

      return {
        full_name: user.full_name ?? user.id,
        role: user.role,
        assigned: progress.assigned,
        completed: progress.completed,
        remaining,
        completion_rate: pct(progress.completed, progress.assigned),
      };
    })
    .sort((a, b) => {
      if (b.assigned !== a.assigned) return b.assigned - a.assigned;
      if (b.completed !== a.completed) return b.completed - a.completed;
      return a.full_name.localeCompare(b.full_name);
    });
}

export function filtersFromSearchParams(
  searchParams: URLSearchParams
): AnalyticsFilters {
  return {
    pathway: searchParams.get("pathway") ?? "",
    subpathway: searchParams.get("subpathway") ?? "",
    schoolType: searchParams.get("school_type") ?? "",
    region: searchParams.get("region") ?? "",
    registrationStatus: searchParams.get("registration_status") ?? "",
    workflowStatus: searchParams.get("workflow_status") ?? "",
  };
}

export async function getAnalyticsReport(
  filters: AnalyticsFilters = {}
): Promise<AnalyticsReport> {
  const [submissions, evaluations, assignments, userProgress] =
    await Promise.all([
      fetchSubmissions(filters),
      fetchOptionalRows("evaluations", "*"),
      fetchOptionalRows("assignments", "*"),
      getLiveUserProgress(),
    ]);

  const submissionIds = new Set(submissions.map((row) => row.id).filter(Boolean));

  const filteredEvaluations = evaluations.filter((row) =>
    submissionIds.has(row.submission_id)
  );

  const filteredAssignments = assignments.filter((row) =>
    submissionIds.has(row.submission_id)
  );

  const evaluatedSubmissionIds = new Set(
    filteredEvaluations.map((row) => row.submission_id).filter(Boolean)
  );

  const selectedStatuses = new Set([
    "selected_for_proofreading",
    "proofreading_done",
    "final_review_in_progress",
    "completed",
  ]);

  const proofreadSubmissionIds = new Set(
    submissions
      .filter(
        (row) =>
          row.general_proofreading_completed_at ||
          row.literary_proofreading_completed_at ||
          ["proofreading_done", "final_review_in_progress", "completed"].includes(
            String(row.workflow_status ?? "")
          )
      )
      .map((row) => row.id)
  );

  const reviewedSubmissionIds = new Set(
    filteredAssignments
      .filter((row) => row.phase === "final_review" && row.status === "completed")
      .map((row) => row.submission_id)
      .filter(Boolean)
  );

  const nationalityTable = countMultiRows(
    submissions,
    (row) => row.participating_students_nationalities,
    normalizeNationality
  );

  const nationalityTotal = nationalityTable.reduce(
    (sum, row) => sum + row.value,
    0
  );

  const nationalityWithPct = nationalityTable.map((row) => ({
    ...row,
    percentage: pct(row.value, nationalityTotal),
  }));

  const uaeStudents = nationalityTable
    .filter((row) => isUaeNationality(row.name))
    .reduce((sum, row) => sum + row.value, 0);

  const nonUaeStudents = Math.max(0, nationalityTotal - uaeStudents);

  const uniqueSchoolRegionRows = Array.from(
    new Map(
      submissions.map((row) => [
        `${row.institution_name ?? "Unknown"}-${row.school_region ?? "Unknown"}`,
        {
          institution_name: row.institution_name,
          school_region: row.school_region,
        },
      ])
    ).values()
  );

  const uniqueSchoolTypeRows = Array.from(
    new Map(
      submissions.map((row) => [
        `${row.institution_name ?? "Unknown"}-${row.institution_type ?? "Unknown"}`,
        {
          institution_name: row.institution_name,
          institution_type: row.institution_type,
        },
      ])
    ).values()
  );

  return {
    generatedAt: new Date(),
    filters,
    kpis: {
      totalSubmissions: submissions.length,
      totalEvaluated: evaluatedSubmissionIds.size,
      totalSelected: submissions.filter((row) =>
        selectedStatuses.has(String(row.workflow_status ?? ""))
      ).length,
      totalProofread: proofreadSubmissionIds.size,
      totalReviewed: reviewedSubmissionIds.size,
      totalReady: submissions.filter((row) => row.workflow_status === "completed")
        .length,
      uniqueStudents: nationalityTotal,
      uaeStudents,
      nonUaeStudents,
      usersTracked: userProgress.length,
    },
    charts: {
      byPathway: countRows(submissions, (row) => row.art_pathway_name_en),
      bySubpathway: countRows(
        submissions,
        (row) => row.art_sub_pathway_name_en
      ),
      bySchoolType: countRows(submissions, (row) => row.institution_type),
      byRegion: countRows(submissions, (row) => row.school_region),
      uniqueSchoolsByRegion: countRows(
        uniqueSchoolRegionRows,
        (row) => row.school_region
      ),
      uniqueSchoolsByType: countRows(
        uniqueSchoolTypeRows,
        (row) => row.institution_type
      ),
      genderRows: countMultiRows(
        submissions,
        (row) => row.participating_students_genders
      ),
      gradeRows: countMultiRows(
        submissions,
        (row) => row.participating_students_grades,
        normalizeGrade
      ),
      cycleRows: countMultiRows(
        submissions,
        (row) => row.participating_students_grades,
        cycleForGrade
      ),
      nationalityTable: nationalityWithPct,
      workflowStatus: countRows(submissions, (row) => row.workflow_status),
      userProgress,
    },
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");

  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

export async function buildAnalyticsDashboardPdfBuffer(
  filters: AnalyticsFilters = {}
) {
  const report = await getAnalyticsReport(filters);

  const pdf = new jsPDF("l", "mm", "a4");

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const deepGreen = hexToRgb("#1C3E3B");
  const sage = hexToRgb("#B2C7C0");
  const cream = hexToRgb("#EBE6DF");
  const card = hexToRgb("#FFFAF4");
  const muted = hexToRgb("#5D726E");
  const border = hexToRgb("#D8DFDA");
  const softTrack = hexToRgb("#E9EEEB");
  const white = hexToRgb("#FFFFFF");
  const rowAlt = hexToRgb("#FAF7F1");

  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 14;

  let y = 14;

  function setText(color: [number, number, number] = deepGreen) {
    pdf.setTextColor(color[0], color[1], color[2]);
  }

  function setFill(color: [number, number, number]) {
    pdf.setFillColor(color[0], color[1], color[2]);
  }

  function setDraw(color: [number, number, number] = border) {
    pdf.setDrawColor(color[0], color[1], color[2]);
  }

  function safe(value: unknown) {
    return cleanText(value) || "—";
  }

  function setFont(size: number, bold = false) {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
  }

  function truncateToWidth(value: unknown, maxWidth: number, size = 7) {
    let text = safe(value);

    setFont(size);

    if (pdf.getTextWidth(text) <= maxWidth) return text;

    while (text.length > 3 && pdf.getTextWidth(`${text.slice(0, -1)}...`) > maxWidth) {
      text = text.slice(0, -1);
    }

    return `${text}...`;
  }

  function text(
    value: unknown,
    x: number,
    textY: number,
    options?: {
      size?: number;
      bold?: boolean;
      color?: [number, number, number];
      maxWidth?: number;
      align?: "left" | "center" | "right";
    }
  ) {
    setFont(options?.size ?? 8, options?.bold ?? false);
    setText(options?.color ?? deepGreen);

    const finalText = safe(value);

    if (options?.maxWidth) {
      const wrapped = pdf.splitTextToSize(finalText, options.maxWidth);
      pdf.text(wrapped, x, textY, { align: options.align ?? "left" });
    } else {
      pdf.text(finalText, x, textY, { align: options?.align ?? "left" });
    }
  }

  function addPageIfNeeded(requiredHeight: number) {
    if (y + requiredHeight <= bottomLimit) return;

    pdf.addPage();
    y = 18;
    drawContinuationHeader();
  }

  function drawContinuationHeader() {
    setFill(cream);
    pdf.rect(0, 0, pageWidth, 10, "F");

    text("ADEK Frontliners Initiative - Analytics Dashboard", margin, 6.7, {
      size: 8,
      bold: true,
    });
  }

  function drawFooter() {
    const pageCount = pdf.getNumberOfPages();

    for (let page = 1; page <= pageCount; page++) {
      pdf.setPage(page);

      text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 7, {
        size: 7,
        color: muted,
        align: "right",
      });
    }
  }

  function drawMainHeader() {
    setFill(white);
    pdf.rect(0, 0, pageWidth, pageHeight, "F");

    setFill(cream);
    setDraw(cream);
    pdf.roundedRect(margin, 10, contentWidth, 28, 3, 3, "FD");

    text("ADEK Frontliners Initiative", margin + 8, 21, {
      size: 17,
      bold: true,
    });

    text("Analytics Dashboard Export", margin + 8, 30, {
      size: 10,
      color: muted,
    });

    text(report.generatedAt.toLocaleString("en-GB"), pageWidth - margin - 8, 21, {
      size: 8,
      color: muted,
      align: "right",
    });

    y = 46;
  }

  function drawFilterSummary() {
    const activeFilters = Object.entries(report.filters).filter(
      ([, value]) => safe(value) !== "—"
    );

    if (!activeFilters.length) return;

    addPageIfNeeded(15);

    setFill(card);
    setDraw(border);
    pdf.roundedRect(margin, y, contentWidth, 12, 2.5, 2.5, "FD");

    text(
      `Filters: ${activeFilters
        .map(([key, value]) => `${key}: ${value}`)
        .join(" | ")}`,
      margin + 5,
      y + 7.5,
      {
        size: 7,
        color: muted,
        maxWidth: contentWidth - 10,
      }
    );

    y += 17;
  }

  function drawKpiCards() {
    const items = [
      ["Total Submissions", report.kpis.totalSubmissions],
      ["Total Evaluated", report.kpis.totalEvaluated],
      ["Total Selected", report.kpis.totalSelected],
      ["Total Proofread", report.kpis.totalProofread],
      ["Total Reviewed", report.kpis.totalReviewed],
      ["Total Ready", report.kpis.totalReady],
      ["Unique Students", report.kpis.uniqueStudents],
      ["UAE Students", report.kpis.uaeStudents],
      ["Non-UAE Students", report.kpis.nonUaeStudents],
      ["Users Tracked", report.kpis.usersTracked],
    ];

    const columns = 5;
    const gap = 4;
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
    const cardHeight = 20;

    addPageIfNeeded(cardHeight * 2 + gap + 6);

    for (let index = 0; index < items.length; index++) {
      const col = index % columns;
      const row = Math.floor(index / columns);

      const x = margin + col * (cardWidth + gap);
      const cardY = y + row * (cardHeight + gap);

      setFill(card);
      setDraw(border);
      pdf.roundedRect(x, cardY, cardWidth, cardHeight, 3, 3, "FD");

      text(items[index][0], x + 4, cardY + 7, {
        size: 7,
        color: muted,
      });

      text(items[index][1], x + 4, cardY + 16.5, {
        size: 15,
        bold: true,
      });
    }

    y += cardHeight * 2 + gap + 8;
  }

  function chartHeight(rows: ChartRow[], limit = 10) {
    const rowCount = Math.min(rows.length, limit);
    return Math.max(38, 18 + rowCount * 6 + (rows.length > limit ? 6 : 0) + 6);
  }

  function drawChartCard({
    x,
    cardY,
    width,
    height,
    title,
    rows,
    limit = 10,
  }: {
    x: number;
    cardY: number;
    width: number;
    height: number;
    title: string;
    rows: ChartRow[];
    limit?: number;
  }) {
    setFill(card);
    setDraw(border);
    pdf.roundedRect(x, cardY, width, height, 3, 3, "FD");

    text(title, x + 5, cardY + 8, {
      size: 10,
      bold: true,
    });

    if (!rows.length) {
      text("No data available.", x + 5, cardY + 18, {
        size: 8,
        color: muted,
      });
      return;
    }

    const visibleRows = rows.slice(0, limit);
    const max = Math.max(...visibleRows.map((row) => row.value), 1);

    const labelWidth = Math.min(55, Math.max(42, width * 0.29));
    const valueWidth = 15;
    const barX = x + 5 + labelWidth + 4;
    const barWidth = width - labelWidth - valueWidth - 19;

    let rowY = cardY + 17;

    for (const row of visibleRows) {
      const label = truncateToWidth(row.name, labelWidth, 7);
      const value = String(row.value);
      const fillWidth = Math.max(2, Math.min(barWidth, (row.value / max) * barWidth));

      text(label, x + 5, rowY + 4, {
        size: 7,
        color: deepGreen,
      });

      setFill(softTrack);
      pdf.roundedRect(barX, rowY, barWidth, 4.3, 2.1, 2.1, "F");

      setFill(deepGreen);
      pdf.roundedRect(barX, rowY, fillWidth, 4.3, 2.1, 2.1, "F");

      text(value, x + width - 6, rowY + 4, {
        size: 7,
        bold: true,
        align: "right",
      });

      rowY += 6;
    }

    if (rows.length > limit) {
      text(`...and ${rows.length - limit} more`, x + 5, rowY + 4, {
        size: 7,
        color: muted,
      });
    }
  }

  function drawChartGrid(
    charts: {
      title: string;
      rows: ChartRow[];
      limit?: number;
    }[]
  ) {
    const gap = 6;
    const cardWidth = (contentWidth - gap) / 2;

    for (let index = 0; index < charts.length; index += 2) {
      const left = charts[index];
      const right = charts[index + 1];

      const leftHeight = chartHeight(left.rows, left.limit ?? 10);
      const rightHeight = right ? chartHeight(right.rows, right.limit ?? 10) : 0;
      const rowHeight = Math.max(leftHeight, rightHeight);

      addPageIfNeeded(rowHeight + 6);

      drawChartCard({
        x: margin,
        cardY: y,
        width: cardWidth,
        height: rowHeight,
        title: left.title,
        rows: left.rows,
        limit: left.limit ?? 10,
      });

      if (right) {
        drawChartCard({
          x: margin + cardWidth + gap,
          cardY: y,
          width: cardWidth,
          height: rowHeight,
          title: right.title,
          rows: right.rows,
          limit: right.limit ?? 10,
        });
      }

      y += rowHeight + 7;
    }
  }

  function drawTableHeader({
    headers,
    columnWidths,
    startX,
    headerY,
  }: {
    headers: string[];
    columnWidths: number[];
    startX: number;
    headerY: number;
  }) {
    setFill(sage);
    pdf.rect(margin, headerY, contentWidth, 8, "F");

    let x = startX;

    headers.forEach((header, index) => {
      text(header, x, headerY + 5.4, {
        size: 7,
        bold: true,
      });
      x += columnWidths[index];
    });
  }

  function drawTableTitle(title: string) {
    addPageIfNeeded(18);

    text(title, margin, y + 5, {
      size: 12,
      bold: true,
    });

    y += 9;
  }

  function drawSimpleTable({
    title,
    headers,
    rows,
    columnWidths,
    numericColumns = [],
  }: {
    title: string;
    headers: string[];
    rows: string[][];
    columnWidths: number[];
    numericColumns?: number[];
  }) {
    drawTableTitle(title);

    const startX = margin + 3;
    const rowHeight = 7;

    drawTableHeader({
      headers,
      columnWidths,
      startX,
      headerY: y,
    });

    y += 8;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      if (y + rowHeight > bottomLimit) {
        pdf.addPage();
        y = 18;
        drawContinuationHeader();

        text(`${title} continued`, margin, y + 5, {
          size: 10,
          bold: true,
        });

        y += 8;

        drawTableHeader({
          headers,
          columnWidths,
          startX,
          headerY: y,
        });

        y += 8;
      }

      if (rowIndex % 2 === 0) {
        setFill(rowAlt);
        pdf.rect(margin, y, contentWidth, rowHeight, "F");
      }

      let x = startX;

      rows[rowIndex].forEach((cell, cellIndex) => {
        const maxWidth = columnWidths[cellIndex] - 4;
        const finalText = truncateToWidth(cell, maxWidth, 7);

        const isNumeric = numericColumns.includes(cellIndex);

        text(finalText, isNumeric ? x + columnWidths[cellIndex] - 5 : x, y + 4.9, {
          size: 7,
          color: cellIndex === 0 ? deepGreen : muted,
          align: isNumeric ? "right" : "left",
        });

        x += columnWidths[cellIndex];
      });

      y += rowHeight;
    }

    y += 7;
  }

  drawMainHeader();
  drawFilterSummary();
  drawKpiCards();

  drawChartGrid([
    {
      title: "Unique Students by Gender",
      rows: report.charts.genderRows,
      limit: 8,
    },
    {
      title: "Unique Students by Grade",
      rows: report.charts.gradeRows,
      limit: 12,
    },
    {
      title: "Unique Students by Cycle",
      rows: report.charts.cycleRows,
      limit: 8,
    },
    {
      title: "Submissions by Region",
      rows: report.charts.byRegion,
      limit: 8,
    },
    {
      title: "Submissions by Pathway",
      rows: report.charts.byPathway,
      limit: 8,
    },
    {
      title: "Submissions by Subpathway",
      rows: report.charts.bySubpathway,
      limit: 8,
    },
    {
      title: "Submissions by School Type",
      rows: report.charts.bySchoolType,
      limit: 8,
    },
    {
      title: "Unique Schools by Region",
      rows: report.charts.uniqueSchoolsByRegion,
      limit: 8,
    },
    {
      title: "Unique Schools by School Type",
      rows: report.charts.uniqueSchoolsByType,
      limit: 8,
    },
    {
      title: "Workflow Status",
      rows: report.charts.workflowStatus,
      limit: 10,
    },
  ]);

  const nationalityTotal = report.charts.nationalityTable.reduce(
    (sum, row) => sum + row.value,
    0
  );

  drawSimpleTable({
    title: "Student Nationalities Table",
    headers: ["Nationality", "Unique Students", "Percentage"],
    rows: report.charts.nationalityTable.map((row) => [
      row.name,
      String(row.value),
      `${pct(row.value, nationalityTotal).toFixed(2)}%`,
    ]),
    columnWidths: [160, 55, 45],
    numericColumns: [1, 2],
  });

  drawSimpleTable({
    title: "User Progress",
    headers: ["User", "Role", "Assigned", "Completed", "Remaining", "Completion Rate"],
    rows: report.charts.userProgress.map((row) => [
      row.full_name,
      row.role,
      String(row.assigned),
      String(row.completed),
      String(row.remaining),
      `${row.completion_rate.toFixed(2)}%`,
    ]),
    columnWidths: [75, 42, 36, 38, 38, 46],
    numericColumns: [2, 3, 4, 5],
  });

  drawFooter();

  return Buffer.from(pdf.output("arraybuffer"));
}