import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

/** What the name prompt is for — drives the copy and the testids. */
export interface AccountNameDialogData {
  title: string;
  /** Optional helper line under the title. */
  description?: string;
  /** Pre-filled name (empty for a brand-new book). */
  initial?: string;
  submitLabel: string;
  /** Testid prefix: `<prefix>-name`, `<prefix>-cancel`, `<prefix>-submit`. */
  testidPrefix: string;
}

/**
 * Name prompt for a book — used both to create a new party ledger and to rename
 * any existing book. Returns the trimmed name, or undefined on cancel.
 */
@Component({
  selector: 'app-account-name-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form (submit)="submit($event)">
      <mat-dialog-content>
        @if (data.description) {
          <p class="mb-3 mt-0 text-sm text-[var(--text-soft)]">{{ data.description }}</p>
        }
        <label class="app-label" for="account-name-field">Name</label>
        <input
          id="account-name-field"
          class="app-field"
          type="text"
          [(ngModel)]="name"
          name="name"
          placeholder="e.g. Rock Ledger 2027"
          autocomplete="off"
          [attr.data-testid]="data.testidPrefix + '-name'"
        />
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button
          mat-button
          type="button"
          mat-dialog-close
          [attr.data-testid]="data.testidPrefix + '-cancel'"
        >
          Cancel
        </button>
        <button
          mat-flat-button
          type="submit"
          [disabled]="!name().trim()"
          [attr.data-testid]="data.testidPrefix + '-submit'"
        >
          {{ data.submitLabel }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class AccountNameDialog {
  protected readonly data = inject<AccountNameDialogData>(MAT_DIALOG_DATA);
  protected readonly name = signal(this.data.initial ?? '');
  private readonly ref = inject<MatDialogRef<AccountNameDialog, string>>(MatDialogRef);

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.name().trim()) this.ref.close(this.name().trim());
  }
}
