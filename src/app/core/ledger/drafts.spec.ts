import { beforeAll, describe, expect, it } from 'vitest';
import { isDraftComplete, type LedgerSnapshot } from './ledger-store';
import { LedgerTransfer } from './ledger-transfer';
import { isPartyDraftComplete, type PartyLedgerSnapshot } from './party-ledger-store';
import { PartyLedgerTransfer } from './party-ledger-transfer';
import { summarize, TRANSFER_APP, TRANSFER_SCHEMA } from '../transfer/transfer.model';
import ledgerRows from '@data/ledger-rows.json';
import rateChart from '@data/rate-chart.json';
import vehicles from '@data/vehicles.json';
import partyRows from '@data/party-ledger-rows.json';
import type { LedgerRow, RateChartEntry, Vehicle } from '../../../domain/types';
import type { PartyLedgerRow } from '../../../domain/party/types';

/**
 * Staged entry drafts: the quarry's raw data arrives without a crusher (or a
 * party, in a party book), so drafts accept incomplete rows — but only complete
 * ones may sync to the ledger, and drafts must survive every backup path.
 */

beforeAll(() => {
  URL.createObjectURL ??= () => 'blob:test';
  URL.revokeObjectURL ??= () => undefined;
});

const row = (patch: Partial<LedgerRow>): LedgerRow => ({
  id: 'x1',
  date: '2025-11-29',
  item: 'Rock',
  crusher: 'Northgate Crusher',
  passType: 'Pass',
  qty: 10,
  quaryRate: 65,
  crusherRate: 190,
  rentRate: 250,
  commRate: 20,
  vehicle: 'KL 00 T 5450',
  ...patch,
});

describe('draft completeness', () => {
  it('a daily draft needs a crusher and a positive qty to sync', () => {
    expect(isDraftComplete(row({}))).toBe(true);
    expect(isDraftComplete(row({ crusher: '' }))).toBe(false);
    expect(isDraftComplete(row({ crusher: '   ' }))).toBe(false);
    expect(isDraftComplete(row({ qty: 0 }))).toBe(false);
  });

  it('a party draft needs a party and a positive qty', () => {
    const partyRow = partyRows[0] as PartyLedgerRow;
    expect(isPartyDraftComplete(partyRow)).toBe(true);
    expect(isPartyDraftComplete({ ...partyRow, party: ' ' })).toBe(false);
    expect(isPartyDraftComplete({ ...partyRow, qty: 0 })).toBe(false);
  });
});

describe('drafts in JSON backups', () => {
  it('daily drafts round-trip through export/parse', async () => {
    const transfer = new LedgerTransfer();
    const snapshot: LedgerSnapshot = {
      rows: (ledgerRows as LedgerRow[]).slice(0, 3),
      rateChart: rateChart as RateChartEntry[],
      vehicles: vehicles as Vehicle[],
      settings: { discountRatePerTon: 20 },
      drafts: [row({ id: 'd1', crusher: '', vehicle: 'KL 00 1042' })],
    };
    const blob = transfer.exportJson(snapshot, 'drafts-test.json');
    const parsed = transfer.parseJson(await blob.text());
    expect(parsed.drafts).toEqual(snapshot.drafts);
  });

  it('party drafts round-trip through export/parse', async () => {
    const transfer = new PartyLedgerTransfer();
    const source = partyRows as PartyLedgerRow[];
    const snapshot: PartyLedgerSnapshot = {
      rows: source.slice(0, 2),
      rates: [],
      vehicles: [],
      drafts: [{ ...source[2], id: 'pd1', party: '' }],
    };
    const blob = transfer.exportJson(snapshot, 'party-drafts-test.json');
    const parsed = transfer.parseJson(await blob.text());
    expect(parsed.drafts).toEqual(snapshot.drafts);
  });

  it('a backup made before drafts existed parses with drafts undefined', () => {
    const transfer = new LedgerTransfer();
    const parsed = transfer.parseJson(JSON.stringify({ rows: [] }));
    expect(parsed.drafts).toBeUndefined();
  });
});

describe('draft collections in a device transfer', () => {
  it('classifies both draft collections, prefixed or not', () => {
    const summary = summarize({
      app: TRANSFER_APP,
      schema: TRANSFER_SCHEMA,
      exportedAt: 0,
      collections: {
        'entry-drafts': { version: 1, updatedAt: 0, data: { rows: [{ id: 'a' }, { id: 'b' }] } },
        'acc:party-sample:party-entry-drafts': {
          version: 1,
          updatedAt: 0,
          data: { rows: [{ id: 'c' }] },
        },
      },
    });

    const daily = summary.collections.find((c) => c.key === 'entry-drafts');
    expect(daily?.status).toBe('ok');
    expect(daily?.detail).toBe('2 rows');

    const party = summary.collections.find(
      (c) => c.key === 'acc:party-sample:party-entry-drafts',
    );
    expect(party?.status).toBe('ok');
    expect(party?.detail).toBe('1 row');
  });
});
