import { describe, expect, it } from 'vitest';
import { pageOf } from './paging';

const items = Array.from({ length: 60 }, (_, i) => i);

describe('pageOf', () => {
  it('windows the list to the requested page', () => {
    const { page, pageCount, clampedIndex } = pageOf(items, 1, 25);
    expect(page).toEqual(items.slice(25, 50));
    expect(pageCount).toBe(3);
    expect(clampedIndex).toBe(1);
  });

  it('the last page holds the remainder', () => {
    expect(pageOf(items, 2, 25).page).toEqual(items.slice(50, 60));
  });

  it('an empty list still yields one (empty) page', () => {
    expect(pageOf([], 0, 25)).toEqual({ page: [], pageCount: 1, clampedIndex: 0 });
  });

  it('clamps an out-of-range index instead of showing nothing', () => {
    // A filter can shrink the list while the user sits on a late page.
    expect(pageOf(items, 99, 25).clampedIndex).toBe(2);
    expect(pageOf(items, -3, 25).clampedIndex).toBe(0);
  });

  it('an exact multiple has no trailing empty page', () => {
    expect(pageOf(items.slice(0, 50), 0, 25).pageCount).toBe(2);
  });
});
