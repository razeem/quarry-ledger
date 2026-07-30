import { Injectable } from '@angular/core';
import { dumpAllCollections, writeCollections } from '../storage/db';
import {
  decode,
  encode,
  importableKeys,
  summarize,
  TRANSFER_APP,
  TRANSFER_SCHEMA,
  TransferPayload,
  TransferSummary,
} from './transfer.model';

export type ImportMode = 'replace' | 'merge';

/**
 * Cross-device data transfer: snapshot the whole IndexedDB model into one
 * portable string (copy/paste or QR) and rehydrate it on another device.
 *
 * Pure serialisation lives in `transfer.model.ts`; this only bridges it to
 * storage + the clock, and applies an imported payload.
 */
@Injectable({ providedIn: 'root' })
export class TransferService {
  /**
   * Snapshot every stored collection into a transfer code.
   * `includeBlobs: false` drops large blobs (QR can't hold them).
   */
  async exportAll({ includeBlobs = true } = {}): Promise<string> {
    const collections = await dumpAllCollections();
    const payload: TransferPayload = {
      app: TRANSFER_APP,
      schema: TRANSFER_SCHEMA,
      exportedAt: Date.now(),
      collections,
    };
    return encode(payload, { includeBlobs });
  }

  /** Decode + validate a pasted/scanned code into a payload. Throws `TransferError`. */
  decode(text: string): Promise<TransferPayload> {
    return decode(text);
  }

  /** Decode a code and describe what importing it would do. */
  async preview(text: string): Promise<TransferSummary> {
    return summarize(await this.decode(text));
  }

  /**
   * Apply a payload to local storage, then reload so every store re-hydrates
   * and runs its own migrator. `merge` writes only the collections present in
   * the payload (incoming wins), leaving others untouched; `replace` clears the
   * store first. Collections the payload marks `newer-unsupported` are skipped.
   */
  async import(payload: TransferPayload, mode: ImportMode): Promise<void> {
    const summary = summarize(payload);
    const allowed = new Set(importableKeys(summary));
    const envelopes = Object.fromEntries(
      Object.entries(payload.collections).filter(([key]) => allowed.has(key)),
    );
    await writeCollections(envelopes, { replace: mode === 'replace' });
    globalThis.location?.reload();
  }
}
