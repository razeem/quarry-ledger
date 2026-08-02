/**
 * Options for a type-ahead panel (crusher / party / vehicle pickers).
 *
 * Unlike a native `<datalist>`, which filters by the current value and so
 * shows nothing but the chosen option once one is picked, this reopens with
 * EVERY option when the value exactly matches one — the panel keeps working
 * like a normal dropdown before and after a choice.
 *
 * Matching is case-insensitive for DISPLAY only; the stored values remain the
 * raw free-text business keys, never normalised.
 */
export function filterOptions(options: readonly string[], value: string): string[] {
  const query = (value ?? '').trim().toLowerCase();
  if (!query) return [...options];
  if (options.some((option) => option.toLowerCase() === query)) return [...options];
  return options.filter((option) => option.toLowerCase().includes(query));
}
