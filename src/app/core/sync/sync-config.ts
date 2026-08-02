/**
 * The runtime backend configuration, read from `public/sync-config.json`.
 *
 * Sync is an optional capability, not a dependency. Every failure mode here —
 * file missing, empty, malformed, offline, 404 — resolves to **sync disabled**,
 * and a disabled app is exactly the app that shipped before sync existed:
 * entry, reports, printing, export and cross-device transfer all keep working.
 * Nothing in this module may throw.
 *
 * The parsing half is pure and unit-tested; only `loadSyncConfig` touches the
 * network.
 */

/** A backend the app can actually talk to. */
export interface SyncConfig {
  url: string;
  anonKey: string;
}

/** Where the generated config lives, relative to the deployed base href. */
export const SYNC_CONFIG_PATH = 'sync-config.json';

/**
 * Validate whatever the config file contained.
 *
 * Both fields must be present and non-empty: a URL with no key would fail at
 * the first request instead of degrading cleanly, which is the whole point of
 * this module. Returns `null` for anything unusable.
 */
export function parseSyncConfig(raw: unknown): SyncConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const url = typeof record['url'] === 'string' ? record['url'].trim() : '';
  const anonKey = typeof record['anonKey'] === 'string' ? record['anonKey'].trim() : '';
  if (!url || !anonKey) return null;

  // A malformed URL would otherwise surface as an opaque fetch failure later.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }

  return { url: url.replace(/\/+$/, ''), anonKey };
}

/**
 * Fetch and parse the config. Resolves to `null` when sync is not configured.
 *
 * `cache: 'no-cache'` so a rotated key is picked up on the next reload rather
 * than being pinned by the HTTP cache — the service worker still serves it
 * offline, which is what makes sync survive a cold PWA start with no network.
 */
export async function loadSyncConfig(
  path: string = SYNC_CONFIG_PATH,
): Promise<SyncConfig | null> {
  try {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) return null;
    return parseSyncConfig(await response.json());
  } catch {
    // Offline, absent, or not JSON — all mean the same thing here.
    return null;
  }
}
