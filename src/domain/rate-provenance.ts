/**
 * Rate provenance — which rate cells a human typed over, and what they held first.
 *
 * A rate is a snapshot: the chart only pre-fills the entry cell, and editing the
 * chart never touches a saved row. That much has always been right. What the row
 * could not say was *why* its rate differs from the chart today — a deliberate
 * override, or simply a chart that has moved on since.
 *
 * Comparing against the current chart cannot answer it, and gets it exactly
 * backwards once rates change:
 *
 * ```
 * chart 650 -> 675 next month
 *   row stored 650, untouched  ->  "differs"  (wrong: nobody touched it)
 *   row stored 675, typed over ->  "matches"  (wrong: a human typed it)
 * ```
 *
 * So the row records it directly. `ratesFrom` holds one `field:value` pair per
 * rate cell that was typed over, carrying the value the cell held *before* the
 * edit — the autofilled one. Absent means every rate matched the chart at entry
 * time, which is true of most rows, so they cost nothing.
 *
 * ## Why a string rather than an array
 *
 * `rowsEqual` compares fields with `===`, which works on a string for free;
 * two identical arrays are never `===`, so an array would read as "changed" on
 * every merge and report a spurious update on every sync. The pairs are written
 * in a fixed (alphabetical) order so two devices building the same row produce
 * the same string, which the last-write-wins tie-break relies on. It is also one
 * legible cell in the continuity workbook rather than seven columns of JSON.
 *
 * ## The encoding's one constraint
 *
 * `:` separates a key from its value and `;` separates pairs, which is safe only
 * because keys are code-controlled identifiers (`quaryRate`, `billRate`) and
 * values are numbers — neither can contain a delimiter. **It would stop being
 * safe for a free-text baseline**, since a name or note could contain `;`. If
 * provenance is ever wanted for a text-valued config, this needs escaping rather
 * than another field.
 *
 * Nothing computes from any of this: it decides a badge and shows "was 650". The
 * golden totals cannot move because of it.
 */

/**
 * What a rate cell held before it was typed over.
 *
 * `null` means there was nothing to compare against — no chart entry existed for
 * that crusher/party, so the cell was typed from nothing. Distinct from both
 * "untouched" (no entry at all) and "changed from a known rate", so a delta is
 * never claimed that cannot be proved.
 */
export type RateBaseline = number | null;

/** One rate cell's current value and what autofill would have put there. */
export interface RateProvenanceInput {
  /** The row field, e.g. `quaryRate`. Must be a code identifier — see above. */
  field: string;
  /** What the cell holds now. */
  value: number;
  /**
   * What autofill would have produced: the chart/setup rate, or `null` when
   * there is no entry to pre-fill from.
   */
  autofill: RateBaseline;
}

const PAIR = ';';
const KEY = ':';

/** Parse `ratesFrom` into field -> baseline. Unreadable pairs are ignored. */
export function parseRatesFrom(text: string | null | undefined): ReadonlyMap<string, RateBaseline> {
  const out = new Map<string, RateBaseline>();
  if (!text) return out;

  for (const pair of text.split(PAIR)) {
    const at = pair.indexOf(KEY);
    if (at <= 0) continue;
    const field = pair.slice(0, at).trim();
    if (!field) continue;
    const raw = pair.slice(at + 1).trim();
    if (raw === '') {
      out.set(field, null);
      continue;
    }
    const value = Number(raw);
    if (Number.isFinite(value)) out.set(field, value);
  }
  return out;
}

/**
 * Serialise field -> baseline back to `ratesFrom`, or `undefined` when nothing
 * was typed over.
 *
 * Keys are sorted so the same set of edits always produces the same string on
 * every device — the property the merge tie-break depends on.
 */
export function formatRatesFrom(
  baselines: ReadonlyMap<string, RateBaseline>,
): string | undefined {
  if (baselines.size === 0) return undefined;
  return [...baselines.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([field, baseline]) => `${field}${KEY}${baseline === null ? '' : baseline}`)
    .join(PAIR);
}

/** The recorded baseline for one field, or `undefined` when it was not typed over. */
export function baselineOf(
  ratesFrom: string | null | undefined,
  field: string,
): RateBaseline | undefined {
  const found = parseRatesFrom(ratesFrom).get(field);
  return found === undefined ? undefined : found;
}

/** True when this rate cell carries a recorded override. */
export function wasTypedOver(ratesFrom: string | null | undefined, field: string): boolean {
  return parseRatesFrom(ratesFrom).has(field);
}

/**
 * The row's `ratesFrom` after a set of rate cells take their current values.
 *
 * One rule covers every path — a new row, an edit through the entry form, and an
 * inline cell edit on the sheet:
 *
 * - **A baseline already recorded wins.** It is the historical fact of what the
 *   cell was typed over *from*, and must survive later edits and chart changes.
 *   Re-deriving it from the current chart is the bug this whole field exists to
 *   fix.
 * - **Otherwise the autofilled value is the baseline** — for a new row that is
 *   the chart's rate; for an inline edit it is the value the cell already held,
 *   which (having no record) was itself autofilled.
 * - **Matching the baseline drops the entry.** Typing in the value autofill
 *   already produced is agreement, not an override, and typing an override back
 *   to its original makes the cell honestly untouched again — the same rule the
 *   settled-amount overrides follow.
 * - **With no chart entry** (`autofill === null`) there is no baseline to match,
 *   so any non-zero value records as typed-with-nothing-to-compare.
 */
export function computeRatesFrom(
  existing: string | null | undefined,
  inputs: readonly RateProvenanceInput[],
): string | undefined {
  const recorded = parseRatesFrom(existing);
  const next = new Map<string, RateBaseline>();

  for (const { field, value, autofill } of inputs) {
    const known = recorded.get(field);
    const baseline = known === undefined ? autofill : known;

    if (baseline === null) {
      if (value !== 0) next.set(field, null);
      continue;
    }
    if (value !== baseline) next.set(field, baseline);
  }

  // Fields outside `inputs` are none of this call's business — an unrelated
  // caller must not silently drop provenance it never looked at.
  for (const [field, baseline] of recorded) {
    if (!inputs.some((input) => input.field === field)) next.set(field, baseline);
  }

  return formatRatesFrom(next);
}
