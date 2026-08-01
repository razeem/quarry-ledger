import { computed, inject, Injectable } from '@angular/core';
import { StorageService } from '../storage/storage.service';
import { newRowId } from '../ledger/ledger-store';

/**
 * Multi-account ("book") support.
 *
 * Each account is a fully self-contained ledger: its collections live under
 * their own IndexedDB keys, its configuration is independent, and the sidebar
 * swaps to the tab set of its type. Two types exist today:
 *
 *  - `daily` — the original Daily Ledger. Exactly one such account exists (the
 *    default), and it keeps the app's ORIGINAL un-prefixed collection keys, so
 *    existing devices upgrade with zero data migration.
 *  - `party` — the party ledger (per-party rates, vehicle-owner rent, profit
 *    splits). Any number can be created; each stores its collections under
 *    `acc:<accountId>:<collection>`.
 */

export type AccountType = 'daily' | 'party';

export interface Account {
  /** Immutable. `DEFAULT_ACCOUNT_ID` for the built-in daily book. */
  id: string;
  name: string;
  type: AccountType;
  /** Unix ms. 0 for the built-in accounts. */
  createdAt: number;
}

/** The daily book — maps to the legacy un-prefixed collection keys. */
export const DEFAULT_ACCOUNT_ID = 'default';
/** The seeded sample party book, created on first run like the daily seed. */
export const SAMPLE_PARTY_ACCOUNT_ID = 'party-sample';

export const BUILT_IN_ACCOUNTS: Account[] = [
  { id: DEFAULT_ACCOUNT_ID, name: 'Daily Ledger', type: 'daily', createdAt: 0 },
  { id: SAMPLE_PARTY_ACCOUNT_ID, name: 'Party Ledger', type: 'party', createdAt: 0 },
];

/**
 * IndexedDB key for one of an account's collections.
 *
 * The default (daily) account deliberately maps to the bare collection name —
 * those keys predate accounts, and remapping them would mean a risky one-shot
 * data migration for no user-visible gain.
 */
export function accountCollectionKey(accountId: string, collection: string): string {
  return accountId === DEFAULT_ACCOUNT_ID ? collection : `acc:${accountId}:${collection}`;
}

/** Split a stored key into its account id + base collection name. */
export function parseCollectionKey(key: string): { accountId: string; collection: string } {
  const match = /^acc:([^:]+):(.+)$/.exec(key);
  return match
    ? { accountId: match[1], collection: match[2] }
    : { accountId: DEFAULT_ACCOUNT_ID, collection: key };
}

interface AccountsDoc {
  accounts: Account[];
  activeId: string;
}

const DEFAULTS: AccountsDoc = {
  accounts: BUILT_IN_ACCOUNTS,
  activeId: DEFAULT_ACCOUNT_ID,
};

export const ACCOUNTS_VERSION = 1;

@Injectable({ providedIn: 'root' })
export class AccountsStore {
  private readonly store = inject(StorageService).bind<AccountsDoc>({
    key: 'accounts',
    version: ACCOUNTS_VERSION,
    defaults: DEFAULTS,
    migrate: (data) => withBuiltIns(data as Partial<AccountsDoc>),
  });

  readonly ready = this.store.ready;

  /** Every account, built-ins first. Never empty. */
  readonly accounts = computed(() => withBuiltIns(this.store.value()).accounts);

  /** The active account — falls back to the daily book if the id is stale. */
  readonly active = computed<Account>(() => {
    const { accounts } = withBuiltIns(this.store.value());
    const activeId = this.store.value().activeId;
    return accounts.find((account) => account.id === activeId) ?? accounts[0];
  });

  readonly partyAccounts = computed(() => this.accounts().filter((a) => a.type === 'party'));

  /**
   * The party book the party tabs operate on: the active account when it is a
   * party account, otherwise the first party book. Party routes stay usable
   * even while the daily book is active (deep links, back navigation).
   */
  readonly activePartyAccount = computed<Account>(() => {
    const active = this.active();
    return active.type === 'party' ? active : this.partyAccounts()[0];
  });

  /** Switch books. Resolves once the choice is on disk. */
  async setActive(id: string): Promise<void> {
    if (!this.accounts().some((account) => account.id === id)) return;
    this.store.patch({ activeId: id });
    await this.store.flush();
  }

  /** Create a new, empty party book and switch to it. Resolves when durable. */
  async createPartyAccount(name: string): Promise<Account> {
    const account: Account = {
      id: `p-${newRowId()}`,
      name: name.trim() || 'New Party Ledger',
      type: 'party',
      createdAt: Date.now(),
    };
    this.store.update((doc) => ({
      accounts: [...withBuiltIns(doc).accounts, account],
      activeId: account.id,
    }));
    await this.store.flush();
    return account;
  }

  /** Rename an account. Built-in ids keep working; only the label changes. */
  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.store.update((doc) => ({
      ...doc,
      accounts: withBuiltIns(doc).accounts.map((account) =>
        account.id === id ? { ...account, name: trimmed } : account,
      ),
    }));
    await this.store.flush();
  }
}

/**
 * Ensure the two built-in accounts always exist and stay first, whatever an
 * older document (or a merge-import) contains.
 */
function withBuiltIns(data: Partial<AccountsDoc> | undefined): AccountsDoc {
  const stored = Array.isArray(data?.accounts) ? data.accounts : [];
  const extras = stored.filter(
    (account): account is Account =>
      !!account?.id &&
      !BUILT_IN_ACCOUNTS.some((builtIn) => builtIn.id === account.id) &&
      (account.type === 'daily' || account.type === 'party'),
  );
  // A stored built-in keeps its (possibly renamed) label.
  const builtIns = BUILT_IN_ACCOUNTS.map((builtIn) => {
    const stored0 = stored.find((account) => account?.id === builtIn.id);
    return stored0?.name ? { ...builtIn, name: stored0.name } : builtIn;
  });
  return {
    accounts: [...builtIns, ...extras],
    activeId: typeof data?.activeId === 'string' ? data.activeId : DEFAULT_ACCOUNT_ID,
  };
}
