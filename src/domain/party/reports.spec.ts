import { describe, expect, it } from 'vitest';
import { partyRatePrefill } from './rates';
import {
  filterPartyRows,
  groupPartyRowsByDay,
  lastActivePartyDateRange,
  ownerRentLines,
  partyStatement,
  reconcileQty,
  sortPartyRowsByDateDesc,
} from './reports';
import { mergePartyRows, partyRowsEqual } from './merge';
import type { PartyLedgerRow, PartyRateConfig } from './types';

const CONFIG: PartyRateConfig[] = [
  {
    party: 'Lakeside Crushers',
    quaryRate: 580,
    rentRate: 210,
    withRent: { billRate: 850, shares: [{ name: 'Owner', perTon: 40 }] },
    withoutRent: { billRate: 650, shares: [{ name: 'Owner', perTon: 50 }] },
  },
];

function row(partial: Partial<PartyLedgerRow>): PartyLedgerRow {
  return {
    id: 'r1',
    date: '2025-10-20',
    party: 'Lakeside Crushers',
    item: 'Rock',
    vehicle: 'KL 00 AS 7477',
    owner: 'Sooraj',
    qty: 30,
    withRent: true,
    quaryRate: 580,
    billRate: 850,
    rentRate: 210,
    profitShares: [{ name: 'Owner', perTon: 40 }],
    ...partial,
  };
}

describe('partyRatePrefill', () => {
  it('resolves the mode the withRent flag selects', () => {
    expect(partyRatePrefill(CONFIG, 'Lakeside Crushers', true)).toEqual({
      quaryRate: 580,
      billRate: 850,
      rentRate: 210,
      profitShares: [{ name: 'Owner', perTon: 40 }],
    });
    expect(partyRatePrefill(CONFIG, 'Lakeside Crushers', false)).toEqual({
      quaryRate: 580,
      billRate: 650,
      rentRate: 0, // rent never applies without rent
      profitShares: [{ name: 'Owner', perTon: 50 }],
    });
  });

  it('misses on an unknown party so the form keeps its values', () => {
    expect(partyRatePrefill(CONFIG, 'Someone New', true)).toBeUndefined();
  });

  it('returns share copies, not references into the config', () => {
    const prefill = partyRatePrefill(CONFIG, 'Lakeside Crushers', true);
    prefill?.profitShares.forEach((s) => (s.perTon = 999));
    expect(CONFIG[0].withRent.shares[0].perTon).toBe(40);
  });
});

describe('ownerRentLines', () => {
  it('keys strictly on the owner string — spelling drift splits lines', () => {
    // The source workbook really contains this bug ('Ratheeesh' vs ' Ratheesh');
    // the report must surface it, not paper over it, because owner is a
    // free-text business key that is never normalised.
    const lines = ownerRentLines([
      row({ id: 'a', owner: 'Ratheeesh 8334' }),
      row({ id: 'b', owner: ' Ratheesh 8334' }),
    ]);
    expect(lines).toHaveLength(2);
  });

  it('excludes without-rent trips entirely', () => {
    const lines = ownerRentLines([row({ id: 'a', withRent: false, rentRate: 0 })]);
    expect(lines).toHaveLength(0);
  });
});

describe('partyStatement', () => {
  it('only counts the named party', () => {
    const statement = partyStatement(
      [row({ id: 'a' }), row({ id: 'b', party: 'Someone Else' })],
      'Lakeside Crushers',
    );
    expect(statement.loads).toBe(1);
  });
});

describe('reconcileQty', () => {
  it('reports the variance against the quarry statement', () => {
    const result = reconcileQty([row({ qty: 30.28 })], 'Lakeside Crushers', 28);
    expect(result.enteredQty).toBeCloseTo(30.28, 6);
    expect(result.variance).toBeCloseTo(2.28, 3);
  });
});

describe('groupPartyRowsByDay', () => {
  it('groups most recent day first, keeping entry order within a day', () => {
    const groups = groupPartyRowsByDay([
      row({ id: 'a', date: '2025-10-16' }),
      row({ id: 'b', date: '2025-10-20' }),
      row({ id: 'c', date: '2025-10-16' }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2025-10-20', '2025-10-16']);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('mergePartyRows', () => {
  it('dedupes by id: same file twice adds nothing', () => {
    const first = mergePartyRows([], [row({ id: 'a' }), row({ id: 'b' })]);
    const second = mergePartyRows(first.rows, [row({ id: 'a' }), row({ id: 'b' })]);
    expect(second.report).toMatchObject({ added: 0, updated: 0, unchanged: 2, total: 2 });
  });

  it('detects a changed profit split as an update', () => {
    const changed = row({ id: 'a', profitShares: [{ name: 'Owner', perTon: 50 }] });
    expect(partyRowsEqual(row({ id: 'a' }), changed)).toBe(false);
    const result = mergePartyRows([row({ id: 'a' })], [changed]);
    expect(result.report.updated).toBe(1);
    expect(result.rows[0].profitShares[0].perTon).toBe(50);
  });

  it('never regenerates or reorders ids', () => {
    const result = mergePartyRows([row({ id: 'a' })], [row({ id: 'b' })]);
    expect(result.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('skips rows without a usable id', () => {
    const result = mergePartyRows([], [row({ id: '' })]);
    expect(result.report.skipped).toBe(1);
    expect(result.rows).toHaveLength(0);
  });
});

describe('filterPartyRows', () => {
  const rows = [
    row({ id: 'a', date: '2025-10-20', party: 'Lakeside Crushers', withRent: true }),
    row({ id: 'b', date: '2025-10-22', party: 'Summit Stone', withRent: false, owner: 'Ratheeesh 8334' }),
    row({ id: 'c', date: '2025-11-01', party: 'Lakeside Crushers', withRent: false, vehicle: 'KL00BA4183' }),
  ];

  it('every criterion empty means every row', () => {
    expect(filterPartyRows(rows, {})).toHaveLength(3);
  });

  it('combines date range, party and rent mode', () => {
    const filtered = filterPartyRows(rows, {
      from: '2025-10-01',
      to: '2025-10-31',
      party: 'Lakeside Crushers',
      rentMode: 'with',
    });
    expect(filtered.map((r) => r.id)).toEqual(['a']);
  });

  it('matches owner exactly — spelling drift stays two distinct owners', () => {
    // The seed deliberately keeps `Ratheeesh 8334` (rows) vs ` Ratheesh 8334`.
    expect(filterPartyRows(rows, { owner: 'Ratheeesh 8334' }).map((r) => r.id)).toEqual(['b']);
    expect(filterPartyRows(rows, { owner: ' Ratheesh 8334' })).toEqual([]);
  });

  it('vehicle matches a raw substring across spacing variants', () => {
    expect(filterPartyRows(rows, { vehicle: '4183' }).map((r) => r.id)).toEqual(['c']);
    expect(filterPartyRows(rows, { vehicle: 'KL 00 BA' })).toEqual([]);
  });

  it('tolerates a reversed date range', () => {
    expect(filterPartyRows(rows, { from: '2025-11-01', to: '2025-10-20' })).toHaveLength(3);
  });
});

describe('sortPartyRowsByDateDesc', () => {
  it('orders newest first, keeps entry order within a day, never mutates', () => {
    const rows = [
      row({ id: 'a', date: '2025-10-20' }),
      row({ id: 'b', date: '2025-11-01' }),
      row({ id: 'c', date: '2025-10-20' }),
    ];
    expect(sortPartyRowsByDateDesc(rows).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('lastActivePartyDateRange', () => {
  it('spans the most recent active dates and is null with no rows', () => {
    const rows = [
      row({ id: 'a', date: '2025-10-20' }),
      row({ id: 'b', date: '2025-10-22' }),
      row({ id: 'c', date: '2025-11-01' }),
    ];
    expect(lastActivePartyDateRange(rows, 2)).toEqual(['2025-10-22', '2025-11-01']);
    expect(lastActivePartyDateRange([], 5)).toBeNull();
  });
});
