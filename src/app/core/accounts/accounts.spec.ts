import { describe, expect, it } from 'vitest';
import {
  accountCollectionKey,
  DEFAULT_ACCOUNT_ID,
  parseCollectionKey,
} from './accounts-store';
import { summarize, TRANSFER_APP, TRANSFER_SCHEMA } from '../transfer/transfer.model';

describe('account collection keys', () => {
  it('maps the default account to the legacy un-prefixed keys', () => {
    // Existing devices must upgrade with zero data migration.
    expect(accountCollectionKey(DEFAULT_ACCOUNT_ID, 'ledger-rows')).toBe('ledger-rows');
  });

  it('namespaces every other account', () => {
    expect(accountCollectionKey('party-sample', 'party-rows')).toBe('acc:party-sample:party-rows');
  });

  it('round-trips through parseCollectionKey', () => {
    expect(parseCollectionKey('acc:party-sample:party-rows')).toEqual({
      accountId: 'party-sample',
      collection: 'party-rows',
    });
    expect(parseCollectionKey('ledger-rows')).toEqual({
      accountId: DEFAULT_ACCOUNT_ID,
      collection: 'ledger-rows',
    });
  });
});

describe('transfer summary with account-prefixed collections', () => {
  it('classifies a prefixed party collection by its base name and labels the book', () => {
    const summary = summarize({
      app: TRANSFER_APP,
      schema: TRANSFER_SCHEMA,
      exportedAt: 0,
      collections: {
        accounts: {
          version: 1,
          updatedAt: 0,
          data: { accounts: [{ id: 'party-sample', name: 'Party Ledger', type: 'party' }] },
        },
        'acc:party-sample:party-rows': {
          version: 1,
          updatedAt: 0,
          data: { rows: [{ id: 'a' }] },
        },
      },
    });

    const partyRows = summary.collections.find((c) => c.key === 'acc:party-sample:party-rows');
    expect(partyRows?.status).toBe('ok');
    expect(partyRows?.label).toBe('Party ledger rows — Party Ledger');
    expect(partyRows?.detail).toBe('1 row');
    expect(summary.importable).toBe(true);
  });
});
