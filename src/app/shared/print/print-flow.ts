/**
 * Hand control to the browser's print dialog once the print-only block has
 * actually rendered. Two animation frames: the first lets the closing options
 * dialog finish its change detection, the second guarantees the `.report-print`
 * DOM is painted before `window.print()` freezes the page.
 */
export async function handoffToPrint(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  window.print();
}

/** Timestamp for the printout footer, in the app's locale. */
export function printStamp(): string {
  return new Date().toLocaleString('en-IN');
}
