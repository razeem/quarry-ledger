import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { computeRow } from '../../../domain/calc';
import { formatDate, formatInr, formatTons } from '../../../domain/format';
import { vehicleOwner } from '../../../domain/rates';
import type { LedgerRow, Vehicle } from '../../../domain/types';

export interface RowDetailData {
  row: LedgerRow;
  vehicles: readonly Vehicle[];
}

/** What the caller should do once the dialog closes. */
export type RowDetailResult = 'edit' | 'delete' | undefined;

/** Read-only breakdown of one ledger row, with edit and delete actions. */
@Component({
  selector: 'app-row-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ row.crusher || 'Load' }}</h2>

    <mat-dialog-content>
      <p class="text-sm text-[var(--text-soft)] mt-0 mb-4">
        {{ formatted.date }} · {{ row.passType ?? 'No pass type' }} ·
        {{ formatted.qty }}
      </p>

      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 m-0 text-sm">
        @for (item of details(); track item.label) {
          <dt class="text-[var(--text-soft)]">{{ item.label }}</dt>
          <dd class="app-num m-0 text-right font-semibold">{{ item.value }}</dd>
        }
      </dl>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close data-testid="row-close">Close</button>
      <button mat-button color="warn" (click)="close('delete')" data-testid="row-delete">
        <mat-icon>delete</mat-icon>
        Delete
      </button>
      <button mat-flat-button (click)="close('edit')" data-testid="row-edit">
        <mat-icon>edit</mat-icon>
        Edit
      </button>
    </mat-dialog-actions>
  `,
})
export class RowDetailDialog {
  private readonly dialogRef = inject(MatDialogRef<RowDetailDialog, RowDetailResult>);
  private readonly data = inject<RowDetailData>(MAT_DIALOG_DATA);

  protected readonly row = this.data.row;

  protected readonly formatted = {
    date: formatDate(this.data.row.date),
    qty: formatTons(this.data.row.qty),
  };

  /** Every derived value, computed on demand — nothing here is stored. */
  protected readonly details = computed(() => {
    const row = this.data.row;
    const c = computeRow(row);
    const owner = vehicleOwner(this.data.vehicles, row.vehicle);

    return [
      { label: 'Vehicle', value: row.vehicle || '—' },
      { label: 'Owner', value: owner || '—' },
      { label: 'Quantity', value: formatTons(row.qty) },
      { label: 'Quary rate', value: `${formatInr(row.quaryRate)}/t` },
      { label: 'Crusher rate', value: `${formatInr(row.crusherRate)}/t` },
      { label: 'Rent rate', value: row.rentRate ? `${formatInr(row.rentRate)}/t` : '—' },
      { label: 'Comm rate', value: row.commRate ? `${formatInr(row.commRate)}/t` : '—' },
      { label: 'Crusher amount', value: formatInr(c.crusherAmount) },
      { label: 'Quary amount', value: formatInr(c.quaryAmount) },
      { label: 'Vehicle rent', value: formatInr(c.vehicleRent) },
      { label: 'Profit', value: formatInr(c.profit) },
      { label: 'Discount', value: formatInr(c.discount) },
    ];
  });

  protected close(result: RowDetailResult): void {
    this.dialogRef.close(result);
  }
}
