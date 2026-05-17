export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

export function firstParam(value: string | string[] | undefined, fallback = "") {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export function getPage(value: string | string[] | undefined) {
  const raw = Number(firstParam(value, "1"));
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.floor(raw);
}

export function getPageSize(value: string | string[] | undefined, fallback = DEFAULT_PAGE_SIZE) {
  const raw = Number(firstParam(value, String(fallback)));
  if (PAGE_SIZE_OPTIONS.includes(raw as any)) return raw;
  return fallback;
}

export function getRange(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { from, to };
}

export function getPageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function buildSearchParams(current: Record<string, string | string[] | undefined>, updates: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== null && first !== "") params.set(key, String(first));
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null || value === "") params.delete(key);
    else params.set(key, String(value));
  }

  return `?${params.toString()}`;
}
