import { describe, expect, it } from 'vitest';
import { parseSyncConfig } from './sync-config';

/**
 * Sync is optional, so the only behaviour that really matters here is that
 * every unusable input degrades to `null` — "no backend" — rather than
 * producing a half-configured client that fails at the first request.
 */
describe('parseSyncConfig', () => {
  it('accepts a complete config and trims a trailing slash', () => {
    expect(parseSyncConfig({ url: 'https://abc.supabase.co/', anonKey: 'key' })).toEqual({
      url: 'https://abc.supabase.co',
      anonKey: 'key',
    });
  });

  it('treats the empty object as sync-off', () => {
    // This is what the generator writes when the env vars are unset, and it is
    // the case every local dev run and the whole e2e suite exercise.
    expect(parseSyncConfig({})).toBeNull();
  });

  it('rejects a half-configured backend rather than half-enabling sync', () => {
    expect(parseSyncConfig({ url: 'https://abc.supabase.co' })).toBeNull();
    expect(parseSyncConfig({ anonKey: 'key' })).toBeNull();
    expect(parseSyncConfig({ url: '   ', anonKey: 'key' })).toBeNull();
    expect(parseSyncConfig({ url: 'https://abc.supabase.co', anonKey: '  ' })).toBeNull();
  });

  it('rejects a malformed or non-http url', () => {
    expect(parseSyncConfig({ url: 'not a url', anonKey: 'key' })).toBeNull();
    expect(parseSyncConfig({ url: 'ftp://abc.example', anonKey: 'key' })).toBeNull();
  });

  it('rejects anything that is not a config object', () => {
    expect(parseSyncConfig(null)).toBeNull();
    expect(parseSyncConfig(undefined)).toBeNull();
    expect(parseSyncConfig('nope')).toBeNull();
    expect(parseSyncConfig([{ url: 'https://a.b', anonKey: 'k' }])).toBeNull();
    expect(parseSyncConfig({ url: 42, anonKey: 7 })).toBeNull();
  });
});
