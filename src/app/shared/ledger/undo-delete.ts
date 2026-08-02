import type { MatSnackBar } from '@angular/material/snack-bar';

export interface UndoableDelete {
  /** Toast text, e.g. "Row deleted". */
  message: string;
  /** The durable delete — awaited BEFORE the toast, so the toast never lies. */
  doDelete: () => Promise<void>;
  /**
   * Undo. Must restore the row under its ORIGINAL id — in practice always
   * `store.restoreRow(row)` / `store.restoreDraft(row)`, never `addRow` (which
   * would mint a new id and break the cross-device merge key).
   *
   * Those two also re-stamp `updatedAt`, without which the revived row would
   * lose to its own tombstone and Undo would quietly do nothing.
   */
  restore: () => void | Promise<void>;
}

/**
 * The one way rows are deleted from the UI: durable delete, then a toast with
 * an Undo action that restores the identical row.
 */
export async function deleteRowWithUndo(
  snackBar: MatSnackBar,
  options: UndoableDelete,
): Promise<void> {
  await options.doDelete();
  const snack = snackBar.open(options.message, 'Undo', { duration: 6000 });
  snack.onAction().subscribe(() => {
    void options.restore();
  });
}
