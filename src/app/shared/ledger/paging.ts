/** One page of a list, with the index clamped into the valid range. */
export interface Paged<T> {
  page: T[];
  pageCount: number;
  /** The index actually shown — `pageIndex` clamped to `[0, pageCount - 1]`. */
  clampedIndex: number;
}

/**
 * Window `items` down to one page. Pure and total: an empty list yields one
 * empty page, and an out-of-range index (say, after a filter shrank the list)
 * clamps to the nearest valid page instead of showing nothing.
 */
export function pageOf<T>(items: readonly T[], pageIndex: number, pageSize: number): Paged<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedIndex = Math.min(Math.max(0, Math.trunc(pageIndex)), pageCount - 1);
  const start = clampedIndex * pageSize;
  return { page: items.slice(start, start + pageSize), pageCount, clampedIndex };
}
