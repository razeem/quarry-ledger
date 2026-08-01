import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';

/** Name prompt for a new party book. Returns the name, or undefined on cancel. */
@Component({
  selector: 'app-new-account-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>New party ledger</h2>
    <form (submit)="create($event)">
      <mat-dialog-content>
        <p class="mb-3 mt-0 text-sm text-[var(--text-soft)]">
          A separate book with its own parties, rates, vehicles and reports.
        </p>
        <label class="app-label" for="new-account-name">Name</label>
        <input
          id="new-account-name"
          class="app-field"
          type="text"
          [(ngModel)]="name"
          name="name"
          placeholder="e.g. Rock Ledger 2027"
          autocomplete="off"
          data-testid="new-account-name"
        />
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close data-testid="new-account-cancel">
          Cancel
        </button>
        <button
          mat-flat-button
          type="submit"
          [disabled]="!name().trim()"
          data-testid="new-account-create"
        >
          Create
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class NewAccountDialog {
  protected readonly name = signal('');
  private readonly ref = inject<MatDialogRef<NewAccountDialog, string>>(MatDialogRef);

  protected create(event: Event): void {
    event.preventDefault();
    if (this.name().trim()) this.ref.close(this.name().trim());
  }
}
