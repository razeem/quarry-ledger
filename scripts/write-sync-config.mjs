#!/usr/bin/env node
/**
 * Generate `public/sync-config.json` from the environment.
 *
 * The app reads this at runtime rather than baking the backend into the bundle,
 * which buys three things:
 *
 *  - **The same built artifact works with or without a backend.** Sync is off
 *    when the file is empty, and the app behaves exactly as it does today.
 *  - **Rotating the key needs no rebuild** — replace the file and reload.
 *  - **Local dev and the e2e run need no setup at all**, which is what keeps
 *    the existing suite passing with no Supabase project in sight.
 *
 * The file is written **unconditionally**, empty when the variables are unset.
 * A missing file would be indistinguishable from a failed deploy, and the
 * service worker would keep serving a stale cached copy; an empty one is an
 * explicit "no backend configured".
 *
 * The anon key is not a secret — it ships in the client either way, and all
 * authority comes from the signed-in user's JWT hitting row-level security. It
 * is a build *variable*, never a build secret.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'public/sync-config.json');

/**
 * Read `.env` for local development, so `npm start` picks the backend up
 * without anyone exporting variables by hand. Real environment variables win,
 * which is what lets CI and `SYNC_OFF=1` override it.
 *
 * Deliberately a five-line parser rather than a dependency: it reads two
 * values, at build time, on a machine that already trusts the file.
 */
function readDotEnv() {
  const file = resolve(root, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...readDotEnv(), ...process.env };

/**
 * `SYNC_OFF=1` forces the empty config regardless of what is configured.
 *
 * The e2e suite sets it: those tests must exercise the app as it behaves with
 * no backend, and must never reach a real project. Step 7's fake backend
 * supplies its own config through request interception instead.
 */
const forcedOff = (env.SYNC_OFF ?? '') !== '';
const url = forcedOff ? '' : (env.SUPABASE_URL ?? '').trim();
const anonKey = forcedOff ? '' : (env.SUPABASE_ANON_KEY ?? '').trim();

// Both or neither: a URL with no key (or vice versa) would fail at the first
// request instead of degrading cleanly to sync-off.
const configured = url !== '' && anonKey !== '';
const config = configured ? { url, anonKey } : {};

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

console.log(
  configured
    ? `sync-config.json written for ${url}`
    : forcedOff
      ? 'sync-config.json written empty — SYNC_OFF is set'
      : 'sync-config.json written empty — sync disabled (SUPABASE_URL / SUPABASE_ANON_KEY unset)',
);
