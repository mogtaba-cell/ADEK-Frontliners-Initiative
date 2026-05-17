import Link from "next/link";
import {
  buildSearchParams,
  getPageCount,
  PAGE_SIZE_OPTIONS,
} from "@/lib/pagination";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

type Props = {
  page: number;
  pageSize: number;

  // Existing usage
  total?: number;
  searchParams?: SearchParamsRecord;

  // Newer usage
  totalResults?: number;
  basePath?: string;
  query?: URLSearchParams;
};

function queryToRecord(query?: URLSearchParams): SearchParamsRecord {
  const record: SearchParamsRecord = {};

  if (!query) return record;

  query.forEach((value, key) => {
    record[key] = value;
  });

  return record;
}

function buildHref({
  basePath,
  query,
  searchParams,
  page,
  pageSize,
}: {
  basePath?: string;
  query?: URLSearchParams;
  searchParams: SearchParamsRecord;
  page: number;
  pageSize: number;
}) {
  if (basePath) {
    const params = new URLSearchParams(query?.toString() ?? "");

    params.set("page", String(page));
    params.set("page_size", String(pageSize));

    const qs = params.toString();

    return qs ? `${basePath}?${qs}` : basePath;
  }

  return buildSearchParams(searchParams, {
    page,
    page_size: pageSize,
  });
}

export function PaginationControls({
  page,
  pageSize,
  total,
  totalResults,
  searchParams,
  basePath,
  query,
}: Props) {
  const safeTotal = total ?? totalResults ?? 0;
  const safeSearchParams = searchParams ?? queryToRecord(query);

  const pageCount = getPageCount(safeTotal, pageSize);
  const firstRow = safeTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(safeTotal, page * pageSize);

  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(pageCount, page + 1);

  const previousHref =
    page <= 1
      ? buildHref({
          basePath,
          query,
          searchParams: safeSearchParams,
          page,
          pageSize,
        })
      : buildHref({
          basePath,
          query,
          searchParams: safeSearchParams,
          page: previousPage,
          pageSize,
        });

  const nextHref =
    page >= pageCount
      ? buildHref({
          basePath,
          query,
          searchParams: safeSearchParams,
          page,
          pageSize,
        })
      : buildHref({
          basePath,
          query,
          searchParams: safeSearchParams,
          page: nextPage,
          pageSize,
        });

  const hiddenEntries = basePath
    ? Array.from((query ?? new URLSearchParams()).entries())
    : Object.entries(safeSearchParams).map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ]);

  return (
    <div className="pagination-bar">
      <div className="muted small">
        Showing <strong>{firstRow}</strong>–<strong>{lastRow}</strong> of{" "}
        <strong>{safeTotal}</strong>
      </div>

      <div className="actions">
        <Link
          className="btn secondary"
          aria-disabled={page <= 1}
          href={previousHref}
        >
          Previous
        </Link>

        <span className="pill">
          Page {page} of {pageCount}
        </span>

        <Link
          className="btn secondary"
          aria-disabled={page >= pageCount}
          href={nextHref}
        >
          Next
        </Link>
      </div>

      <form className="actions" method="get" action={basePath}>
        {hiddenEntries.map(([key, value]) => {
          if (key === "page" || key === "page_size") return null;
          if (!value) return null;

          return (
            <input
              key={key}
              type="hidden"
              name={key}
              value={String(value)}
            />
          );
        })}

        <input type="hidden" name="page" value="1" />

        <label className="actions small">
          Page size
          <select
            className="input compact-input"
            name="page_size"
            defaultValue={pageSize}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button className="btn secondary" type="submit">
          Apply
        </button>
      </form>
    </div>
  );
}