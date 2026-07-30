import { DBSchema, IDBPDatabase, openDB } from 'idb';

export const DB_NAME = 'quarry-ledger-db';

/**
 * IndexedDB structural version. Bump this ONLY when the set of object stores
 * or their indexes changes, and add a matching `if (oldVersion < N)` block in
 * `upgrade()` below. Per-document shape changes are handled separately by each
 * collection's `version` + `migrate` (see StorageService), so most feature
 * evolution never touches this number.
 */
export const DB_VERSION = 1;

/** Envelope wrapping every stored document so its schema version travels with the data. */
export interface StoredEnvelope<T = unknown> {
  version: number;
  data: T;
  updatedAt: number;
}

export interface AppSchema extends DBSchema {
  collections: {
    key: string;
    value: StoredEnvelope;
  };
}

let dbPromise: Promise<IDBPDatabase<AppSchema>> | null = null;

/** Lazily open (and cache) the shared database connection. */
export function getDb(): Promise<IDBPDatabase<AppSchema>> {
  dbPromise ??= openDB<AppSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // --- Structural (IndexedDB-level) migrations, applied in order ---
      if (oldVersion < 1) {
        // v1: single key/value store; the key is the collection name.
        db.createObjectStore('collections');
      }
      // Example future structural change:
      // if (oldVersion < 2) {
      //   const files = db.createObjectStore('files', { keyPath: 'id' });
      //   files.createIndex('byOwner', 'ownerId');
      // }
    },
  });
  return dbPromise;
}

/** Test/utility hook: drop the cached connection so a fresh one is opened next time. */
export function resetDbConnection(): void {
  dbPromise = null;
}

/**
 * Read every stored collection as a `{ key -> envelope }` map. Used by the
 * data-transfer export to snapshot the whole model in one pass (there is no
 * other bulk reader; feature stores only ever touch their own single key).
 */
export async function dumpAllCollections(): Promise<Record<string, StoredEnvelope>> {
  const db = await getDb();
  const [keys, values] = await Promise.all([
    db.getAllKeys('collections'),
    db.getAll('collections'),
  ]);
  const out: Record<string, StoredEnvelope> = {};
  keys.forEach((key, i) => {
    out[key] = values[i];
  });
  return out;
}

/**
 * Bulk-install a `{ key -> envelope }` map in a single transaction. With
 * `replace`, the whole store is cleared first (full overwrite); otherwise each
 * supplied key is written over its existing value (per-collection merge) and
 * untouched keys are left alone. A page reload afterwards lets every store
 * re-hydrate + run its own migrator.
 */
export async function writeCollections(
  envelopes: Record<string, StoredEnvelope>,
  { replace }: { replace: boolean },
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('collections', 'readwrite');
  if (replace) await tx.store.clear();
  await Promise.all(
    Object.entries(envelopes).map(([key, envelope]) => tx.store.put(envelope, key)),
  );
  await tx.done;
}
