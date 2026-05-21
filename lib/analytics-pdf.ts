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
  proofreader_type?: string | null;
  assigned: number;
  completed: number;
  remaining: number;
  sent_for_correction: number;
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

const SUBMISSION_ANALYTICS_SELECT = `
  id,
  reference_id,
  art_pathway_name_en,
  art_sub_pathway_name_en,
  institution_type,
  school_region,
  institution_ref_number,
  institution_name,
  registration_status,
  workflow_status,
  evaluation_decision,
  management_decision,
  reviewer_decision,
  participating_students_nationalities,
  participating_students_genders,
  participating_students_grades,
  general_proofreading_completed_at,
  literary_proofreading_completed_at
`;

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

function isUaeNationality(name: string) {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === "uae" ||
    normalized === "u.a.e" ||
    normalized === "u.a.e." ||
    normalized.includes("united arab emirates") ||
    normalized.includes("emirati") ||
    normalized.includes("الإمارات") ||
    normalized.includes("الامارات")
  );
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

function addCount(map: Map<string, number>, key: unknown) {
  const label = cleanText(key) || "Unknown";
  map.set(label, (map.get(label) ?? 0) + 1);
}

function mapToRows(map: Map<string, number>): ChartRow[] {
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function countMultiRows(
  rows: AnyRow[],
  getter: (row: AnyRow) => unknown,
  normalizer?: (value: unknown) => string
): ChartRow[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const parts = splitMultiValue(getter(row));

    if (!parts.length) {
      addCount(counts, "Unknown");
      continue;
    }

    for (const part of parts) {
      addCount(counts, normalizer ? normalizer(part) : part);
    }
  }

  return mapToRows(counts);
}

async function fetchSubmissions(filters: AnalyticsFilters) {
  const pageSize = 500;
  let from = 0;
  const rows: AnyRow[] = [];

  while (true) {
    let query = supabaseAdmin
      .from("submissions")
      .select(SUBMISSION_ANALYTICS_SELECT)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (filters.pathway) query = query.eq("art_pathway_name_en", filters.pathway);
    if (filters.subpathway) query = query.eq("art_sub_pathway_name_en", filters.subpathway);
    if (filters.schoolType) query = query.eq("institution_type", filters.schoolType);
    if (filters.region) query = query.eq("school_region", filters.region);
    if (filters.registrationStatus) query = query.eq("registration_status", filters.registrationStatus);
    if (filters.workflowStatus) query = query.eq("workflow_status", filters.workflowStatus);

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

async function fetchAllRows(table: string, select: string, options?: { pageSize?: number }) {
  const pageSize = options?.pageSize ?? 1000;
  let from = 0;
  const rows: AnyRow[] = [];

  while (true) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`${table} query failed: ${error.message}`);
    }

    const pageRows = (data ?? []) as AnyRow[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function getLiveUserProgress(): Promise<UserProgressRow[]> {
  try {
    const users = await fetchAllRows(
      "profiles",
      "id,full_name,role,is_active,proofreader_type"
    );

    const activeUsers = users.filter(
      (user) =>
        user.is_active === true &&
        !["admin", "adek_hq"].includes(String(user.role ?? ""))
    );

    const userIds = new Set(activeUsers.map((user) => user.id));

    const assignments = await fetchAllRows(
      "assignments",
      "assigned_to,submission_id,status,completed_at,phase,proofreader_type",
      { pageSize: 1000 }
    );

    const progressMap = new Map<
      string,
      {
        assigned: Set<string>;
        completed: Set<string>;
        remaining: Set<string>;
        sentForCorrection: Set<string>;
      }
    >();

    for (const user of activeUsers) {
      progressMap.set(user.id, {
        assigned: new Set(),
        completed: new Set(),
        remaining: new Set(),
        sentForCorrection: new Set(),
      });
    }

    for (const assignment of assignments) {
      if (!assignment.assigned_to || !assignment.submission_id) continue;
      if (!userIds.has(assignment.assigned_to)) continue;

      const status = String(assignment.status ?? "");
      if (status === "cancelled") continue;

      const current = progressMap.get(assignment.assigned_to);
      if (!current) continue;

      current.assigned.add(assignment.submission_id);

      if (status === "completed" && assignment.completed_at) {
        current.completed.add(assignment.submission_id);
      }

      if (["assigned", "in_progress", "returned_for_correction", "sent_for_review"].includes(status)) {
        current.remaining.add(assignment.submission_id);
      }

      if (status === "returned_for_correction") {
        current.sentForCorrection.add(assignment.submission_id);
      }
    }

    return activeUsers
      .map((user) => {
        const progress = progressMap.get(user.id) ?? {
          assigned: new Set<string>(),
          completed: new Set<string>(),
          remaining: new Set<string>(),
          sentForCorrection: new Set<string>(),
        };

        return {
          full_name: user.full_name ?? user.id,
          role: user.role ?? "unknown",
          proofreader_type: user.proofreader_type ?? null,
          assigned: progress.assigned.size,
          completed: progress.completed.size,
          remaining: progress.remaining.size,
          sent_for_correction: progress.sentForCorrection.size,
          completion_rate: pct(progress.completed.size, progress.assigned.size),
        };
      })
      .sort((a, b) => b.assigned - a.assigned || a.full_name.localeCompare(b.full_name));
  } catch (error) {
    console.error("Live user progress PDF query failed:", error);
    return [];
  }
}

export function filtersFromSearchParams(searchParams: URLSearchParams): AnalyticsFilters {
  return {
    pathway: searchParams.get("pathway") ?? "",
    subpathway: searchParams.get("subpathway") ?? "",
    schoolType: searchParams.get("school_type") ?? "",
    region: searchParams.get("region") ?? "",
    registrationStatus: searchParams.get("registration_status") ?? "",
    workflowStatus: searchParams.get("workflow_status") ?? "",
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

function truncateText(pdf: jsPDF, value: unknown, width: number) {
  let text = cleanText(value) || "—";
  if (pdf.getTextWidth(text) <= width) return text;

  while (text.length > 3 && pdf.getTextWidth(`${text.slice(0, -1)}...`) > width) {
    text = text.slice(0, -1);
  }

  return `${text}...`;
}

export async function buildAnalyticsDashboardPdfBuffer(filters: AnalyticsFilters = {}) {
  const [submissions, userProgress] = await Promise.all([
    fetchSubmissions(filters),
    getLiveUserProgress(),
  ]);

  const byPathway = new Map<string, number>();
  const bySubpathway = new Map<string, number>();
  const bySchoolType = new Map<string, number>();
  const byRegion = new Map<string, number>();
  const byWorkflow = new Map<string, number>();
  const schoolsByRegion = new Map<string, Set<string>>();
  const schoolsByType = new Map<string, Set<string>>();

  for (const row of submissions) {
    addCount(byPathway, row.art_pathway_name_en);
    addCount(bySubpathway, row.art_sub_pathway_name_en);
    addCount(bySchoolType, row.institution_type);
    addCount(byRegion, row.school_region);
    addCount(byWorkflow, row.workflow_status);

    const schoolKey = cleanText(row.institution_ref_number) || cleanText(row.institution_name) || "Unknown School";
    const region = cleanText(row.school_region) || "Unknown";
    const type = cleanText(row.institution_type) || "Unknown";

    if (!schoolsByRegion.has(region)) schoolsByRegion.set(region, new Set());
    if (!schoolsByType.has(type)) schoolsByType.set(type, new Set());
    schoolsByRegion.get(region)?.add(schoolKey);
    schoolsByType.get(type)?.add(schoolKey);
  }

  const nationalityTable = countMultiRows(
    submissions,
    (row) => row.participating_students_nationalities,
    normalizeNationality
  );
  const nationalityTotal = nationalityTable.reduce((sum, row) => sum + row.value, 0);
  const uaeStudents = nationalityTable
    .filter((row) => isUaeNationality(row.name))
    .reduce((sum, row) => sum + row.value, 0);
  const nonUaeStudents = Math.max(0, nationalityTotal - uaeStudents);

  const genderRows = countMultiRows(submissions, (row) => row.participating_students_genders);
  const gradeRows = countMultiRows(submissions, (row) => row.participating_students_grades, normalizeGrade);
  const cycleRows = countMultiRows(submissions, (row) => row.participating_students_grades, cycleForGrade);

  const uniqueSchoolRows = (map: Map<string, Set<string>>) =>
    Array.from(map.entries())
      .map(([name, set]) => ({ name, value: set.size }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  const pdf = new jsPDF("l", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const deepGreen = hexToRgb("#1C3E3B");
  const sage = hexToRgb("#B2C7C0");
  const cream = hexToRgb("#EBE6DF");
  const card = hexToRgb("#FFFAF4");
  const muted = hexToRgb("#5D726E");
  const border = hexToRgb("#D8DFDA");
  const track = hexToRgb("#E9EEEB");

  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const bottom = pageHeight - 14;
  let y = 14;

  function setFont(size: number, bold = false) {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
  }

  function setText(color = deepGreen) {
    pdf.setTextColor(color[0], color[1], color[2]);
  }

  function text(value: unknown, x: number, textY: number, options?: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right" | "center"; maxWidth?: number }) {
    setFont(options?.size ?? 8, options?.bold ?? false);
    setText(options?.color ?? deepGreen);
    const finalText = cleanText(value) || "—";

    if (options?.maxWidth) {
      pdf.text(pdf.splitTextToSize(finalText, options.maxWidth), x, textY, { align: options.align ?? "left" });
    } else {
      pdf.text(finalText, x, textY, { align: options?.align ?? "left" });
    }
  }

  function fill(color: [number, number, number]) {
    pdf.setFillColor(color[0], color[1], color[2]);
  }

  function draw(color: [number, number, number]) {
    pdf.setDrawColor(color[0], color[1], color[2]);
  }

  function addPageIfNeeded(requiredHeight: number) {
    if (y + requiredHeight <= bottom) return;
    pdf.addPage();
    y = 18;
    fill(cream);
    pdf.rect(0, 0, pageWidth, 10, "F");
    text("ADEK Frontliners Initiative - Analytics Dashboard", margin, 6.7, { size: 8, bold: true });
  }

  function drawKpis() {
    const selectedStatuses = new Set(["selected_for_proofreading", "proofreading_done", "final_review_in_progress", "completed"]);
    const kpis: [string, number][] = [
      ["Total Submissions", submissions.length],
      ["Evaluated", submissions.filter((row) => row.evaluation_decision).length],
      ["Selected", submissions.filter((row) => selectedStatuses.has(String(row.workflow_status ?? ""))).length],
      ["Proofread", submissions.filter((row) => row.general_proofreading_completed_at || row.literary_proofreading_completed_at).length],
      ["Completed", submissions.filter((row) => row.workflow_status === "completed" || row.reviewer_decision === "completed").length],
      ["Unique Students", nationalityTotal],
      ["UAE Students", uaeStudents],
      ["Non-UAE Students", nonUaeStudents],
      ["Users Tracked", userProgress.length],
    ];

    const columns = 3;
    const gap = 5;
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
    const cardHeight = 18;

    for (let index = 0; index < kpis.length; index++) {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + col * (cardWidth + gap);
      const cardY = y + row * (cardHeight + gap);

      fill(card);
      draw(border);
      pdf.roundedRect(x, cardY, cardWidth, cardHeight, 3, 3, "FD");
      text(kpis[index][0], x + 4, cardY + 6.5, { size: 7, color: muted });
      text(kpis[index][1], x + 4, cardY + 15, { size: 13, bold: true });
    }

    y += cardHeight * 3 + gap * 2 + 8;
  }

  function drawChart(title: string, rows: ChartRow[], x: number, chartY: number, width: number, height: number, limit = 8) {
    fill(card);
    draw(border);
    pdf.roundedRect(x, chartY, width, height, 3, 3, "FD");
    text(title, x + 5, chartY + 8, { size: 9, bold: true });

    const visible = rows.slice(0, limit);
    if (!visible.length) {
      text("No data available.", x + 5, chartY + 18, { size: 7, color: muted });
      return;
    }

    const max = Math.max(...visible.map((row) => row.value), 1);
    const labelWidth = Math.min(52, width * 0.34);
    const barX = x + 5 + labelWidth + 4;
    const barWidth = width - labelWidth - 26;
    let rowY = chartY + 17;

    for (const row of visible) {
      text(truncateText(pdf, row.name, labelWidth), x + 5, rowY + 4, { size: 6.5 });
      fill(track);
      pdf.roundedRect(barX, rowY, barWidth, 4, 2, 2, "F");
      fill(deepGreen);
      pdf.roundedRect(barX, rowY, Math.max(2, (row.value / max) * barWidth), 4, 2, 2, "F");
      text(row.value, x + width - 5, rowY + 3.8, { size: 6.5, bold: true, align: "right" });
      rowY += 6;
    }
  }

  function drawCharts(charts: { title: string; rows: ChartRow[] }[]) {
    const gap = 6;
    const cardWidth = (contentWidth - gap) / 2;
    const cardHeight = 70;

    for (let index = 0; index < charts.length; index += 2) {
      addPageIfNeeded(cardHeight + 8);
      drawChart(charts[index].title, charts[index].rows, margin, y, cardWidth, cardHeight);
      if (charts[index + 1]) {
        drawChart(charts[index + 1].title, charts[index + 1].rows, margin + cardWidth + gap, y, cardWidth, cardHeight);
      }
      y += cardHeight + 8;
    }
  }

  function drawUserProgress() {
    addPageIfNeeded(36);
    text("User Progress", margin, y, { size: 12, bold: true });
    y += 5;

    const headers = ["User", "Role", "Assigned", "Completed", "Remaining", "Sent Corr.", "Rate"];
    const widths = [70, 42, 22, 24, 24, 25, 20];
    const startX = margin;

    fill(sage);
    pdf.rect(margin, y, contentWidth, 8, "F");
    let x = startX;
    for (let i = 0; i < headers.length; i++) {
      text(headers[i], x + 2, y + 5.2, { size: 6.5, bold: true });
      x += widths[i];
    }
    y += 8;

    const rows = userProgress.slice(0, 40);
    for (const row of rows) {
      addPageIfNeeded(7);
      x = startX;
      const values = [
        row.full_name,
        row.proofreader_type ? `${row.role} / ${row.proofreader_type}` : row.role,
        row.assigned,
        row.completed,
        row.remaining,
        row.sent_for_correction,
        `${row.completion_rate.toFixed(1)}%`,
      ];

      for (let i = 0; i < values.length; i++) {
        text(truncateText(pdf, values[i], widths[i] - 4), x + 2, y + 5, { size: 6.5 });
        x += widths[i];
      }
      y += 7;
    }

    if (userProgress.length > rows.length) {
      text(`...and ${userProgress.length - rows.length} more users`, margin, y + 4, { size: 7, color: muted });
      y += 8;
    }
  }

  fill([255, 255, 255]);
  pdf.rect(0, 0, pageWidth, pageHeight, "F");
  fill(cream);
  draw(cream);
  pdf.roundedRect(margin, 10, contentWidth, 28, 3, 3, "FD");
  text("ADEK Frontliners Initiative", margin + 8, 21, { size: 17, bold: true });
  text("Analytics Dashboard Export", margin + 8, 30, { size: 10, color: muted });
  text(new Date().toLocaleString("en-GB"), pageWidth - margin - 8, 21, { size: 8, color: muted, align: "right" });
  y = 46;

  const activeFilters = Object.entries(filters).filter(([, value]) => cleanText(value));
  if (activeFilters.length) {
    fill(card);
    draw(border);
    pdf.roundedRect(margin, y, contentWidth, 12, 2.5, 2.5, "FD");
    text(`Filters: ${activeFilters.map(([key, value]) => `${key}: ${value}`).join(" | ")}`, margin + 5, y + 7.5, { size: 7, color: muted, maxWidth: contentWidth - 10 });
    y += 17;
  }

  drawKpis();
  drawCharts([
    { title: "Submissions by Workflow Status", rows: mapToRows(byWorkflow) },
    { title: "Submissions by Region", rows: mapToRows(byRegion) },
    { title: "Submissions by Pathway", rows: mapToRows(byPathway) },
    { title: "Submissions by Subpathway", rows: mapToRows(bySubpathway) },
    { title: "Submissions by School Type", rows: mapToRows(bySchoolType) },
    { title: "Unique Schools by Region", rows: uniqueSchoolRows(schoolsByRegion) },
    { title: "Unique Schools by School Type", rows: uniqueSchoolRows(schoolsByType) },
    { title: "Unique Students by Gender", rows: genderRows },
    { title: "Unique Students by Grade", rows: gradeRows },
    { title: "Unique Students by Cycle", rows: cycleRows },
    { title: "Unique Students by Nationality", rows: nationalityTable },
  ]);
  drawUserProgress();

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page);
    text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 7, { size: 7, color: muted, align: "right" });
  }

  return Buffer.from(pdf.output("arraybuffer"));
}
