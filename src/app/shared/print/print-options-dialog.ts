import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';

/** One printable section a page offers. */
export interface PrintChoice<K extends string = string> {
  key: K;
  label: string;
  hint: string;
  /** True when the section is scoped to a chosen date rather than all time. */
  dateScoped?: boolean;
}

export interface PrintOptionsData<K extends string = string> {
  /** The page's sections, in the order they will print. */
  choices: readonly PrintChoice<K>[];
  /** Pre-ticked sections (usually whichever view is open). */
  selected: readonly K[];
  /** Label shown next to date-scoped choices, e.g. "29 Nov 2025". */
  dateLabel?: string;
  /** Sections that would print with no rows, flagged in the list. */
  emptyKeys: readonly K[];
}

export interface PrintOptions<K extends string = string> {
  /** Chosen sections, in the canonical `choices` order. */
  sections: K[];
}

/**
 * Pick which of a page's report sections go into the printout before opening
 * the browser's print dialog (where "Save as PDF" is the usual destination).
 * Generic over the section keys — the daily Reports page and both party pages
 * pass their own choice lists.
 */
@Component({
  selector: 'app-print-options-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Print or save as PDF</h2>

    <mat-dialog-content>
      <p class="mt-0 mb-4 text-sm text-[var(--text-soft)]">
        Choose the sections to include. Your browser's print dialog opens next — pick
        <strong>Save as PDF</strong> there to keep a copy.
      </p>

      <div class="flex flex-col gap-3">
        @for (section of data.choices; track section.key) {
          <div>
            <mat-checkbox
              [checked]="isChecked(section.key)"
              (change)="toggle(section.key, $event.checked)"
              [attr.data-testid]="'print-section-' + section.key"
            >
              {{ section.label }}
              @if (section.dateScoped && data.dateLabel) {
                <span class="text-[var(--text-soft)]">· {{ data.dateLabel }}</span>
              }
            </mat-checkbox>
            <p class="mt-0 mb-0 ml-9 text-xs text-[var(--text-soft)]">
              {{ section.hint }}
              @if (isEmpty(section.key)) {
                — <strong>no data</strong>, will print as empty
              }
            </p>
          </div>
        }
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close data-testid="print-cancel">Cancel</button>
      <button
        mat-flat-button
        [disabled]="chosen().length === 0"
        (click)="confirm()"
        data-testid="print-confirm"
      >
        <mat-icon>print</mat-icon>
        Print {{ chosen().length }} section{{ chosen().length === 1 ? '' : 's' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class PrintOptionsDialog {
  private readonly dialogRef = inject(MatDialogRef<PrintOptionsDialog, PrintOptions>);
  protected readonly data = inject<PrintOptionsData>(MAT_DIALOG_DATA);

  private readonly selected = signal<ReadonlySet<string>>(new Set(this.data.selected));
  protected readonly chosen = computed(() =>
    this.data.choices.filter((s) => this.selected().has(s.key)).map((s) => s.key),
  );

  protected isChecked(key: string): boolean {
    return this.selected().has(key);
  }

  protected isEmpty(key: string): boolean {
    return this.data.emptyKeys.includes(key);
  }

  protected toggle(key: string, checked: boolean): void {
    this.selected.update((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  protected confirm(): void {
    // Return sections in the canonical order, not the order they were ticked.
    this.dialogRef.close({ sections: this.chosen() });
  }
}
