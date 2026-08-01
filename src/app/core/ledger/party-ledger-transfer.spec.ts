import { beforeAll, describe, expect, it } from 'vitest';
import {
  formatShares,
  parseShares,
  PartyLedgerTransfer,
} from './party-ledger-transfer';
import type { PartyLedgerSnapshot } from './party-ledger-store';
import partyRows from '@data/party-ledger-rows.json';
import partyRates from '@data/party-rates.json';
import partyVehicles from '@data/party-vehicles.json';
import type { PartyLedgerRow, PartyRateConfig } from '../../../domain/party/types';
import type { Vehicle } from '../../../domain/types';

/**
 * The export/import contract: a full snapshot must survive a round trip — ids,
 * free-text quirks, booleans and the profit-split cells. Uses the real seed
 * (35 rows) so every quirk that exists in production data is exercised.
 *
 * One deliberate tolerance, identical to the daily `LedgerTransfer`: cell
 * coercion trims LEADING/TRAILING whitespace at the file boundary (edge
 * whitespace is invisible in Excel and almost always accidental), while
 * INTERNAL spacing quirks — `KL00BA4183` vs `KL 00 BA 4183` — are preserved
 * exactly. The seed's ` Ratheesh 8334` owner therefore imports trimmed; the
 * expectation below encodes that knowingly.
 */

const SNAPSHOT: PartyLedgerSnapshot = {
  rows: partyRows as PartyLedgerRow[],
  rates: partyRates as PartyRateConfig[],
  vehicles: partyVehicles as Vehicle[],
};

/** The snapshot as the file boundary hands it back: edge whitespace trimmed. */
const EDGE_TRIMMED_VEHICLES = SNAPSHOT.vehicles.map((vehicle) => ({
  num: vehicle.num.trim(),
  owner: vehicle.owner.trim(),
}));

beforeAll(() => {
  // jsdom lacks the blob-URL APIs the download helper touches.
  URL.createObjectURL ??= () => 'blob:test';
  URL.revokeObjectURL ??= () => undefined;
});

describe('profit-split cell format', () => {
  it('round-trips shares through the compact text form', () => {
    const shares = [
      { name: 'Owner', perTon: 40 },
      { name: 'Adjust', perTon: 20 },
    ];
    expect(formatShares(shares)).toBe('Owner:40; Adjust:20');
    expect(parseShares('Owner:40; Adjust:20')).toEqual(shares);
  });

  it('splits on the LAST colon so names may contain one', () => {
    expect(parseShares('A:B:15')).toEqual([{ name: 'A:B', perTon: 15 }]);
  });

  it('tolerates blanks and junk without inventing shares', () => {
    expect(parseShares('')).toEqual([]);
    expect(parseShares(' ; ;')).toEqual([]);
    expect(parseShares('no-rate-here')).toEqual([]);
  });
});

describe('xlsx round trip', () => {
  it('reproduces the full seed snapshot exactly', async () => {
    const transfer = new PartyLedgerTransfer();
    const blob = await transfer.exportXlsx(SNAPSHOT, 'round-trip-test.xlsx');
    const parsed = await transfer.parseXlsx(await blob.arrayBuffer());

    expect(parsed.rows).toEqual(SNAPSHOT.rows);
    expect(parsed.rates).toEqual(SNAPSHOT.rates);
    expect(parsed.vehicles).toEqual(EDGE_TRIMMED_VEHICLES);
    // The seed's quirks survive: real production data contains this drift.
    expect(parsed.vehicles?.some((v) => v.owner === 'Ratheesh 8334')).toBe(true);
    expect(parsed.rows?.some((r) => r.owner === 'Ratheeesh 8334')).toBe(true);
  }, 30_000);

  it('skips sheet rows that arrive without an id', async () => {
    const transfer = new PartyLedgerTransfer();
    const withBlankId = {
      ...SNAPSHOT,
      rows: [{ ...SNAPSHOT.rows[0], id: '' }, SNAPSHOT.rows[1]],
    };
    const blob = await transfer.exportXlsx(withBlankId, 'skip-test.xlsx');
    const parsed = await transfer.parseXlsx(await blob.arrayBuffer());
    expect(parsed.rows).toEqual([SNAPSHOT.rows[1]]);
  }, 30_000);
});

describe('json round trip', () => {
  it('reproduces the full seed snapshot exactly', async () => {
    const transfer = new PartyLedgerTransfer();
    const blob = transfer.exportJson(SNAPSHOT, 'round-trip-test.json');
    const parsed = transfer.parseJson(await blob.text());

    expect(parsed.rows).toEqual(SNAPSHOT.rows);
    expect(parsed.rates).toEqual(SNAPSHOT.rates);
    expect(parsed.vehicles).toEqual(EDGE_TRIMMED_VEHICLES);
  });
});
