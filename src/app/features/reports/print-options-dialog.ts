import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { formatDate } from '../../../domain/format';

/** The printable report sections. */
export type PrintSection = 'daily' | 'rent' | 'crusher' | 'monthly';

export interface PrintOptions {
  sections: PrintSection[];
  /** Date driving the two date-scoped sections. */
  date: string;
}

export interface PrintOptionsData {
  /** Pre-ticked sections (defaults to whichever view is open). */
  sections: PrintSection[];
  date: string;
  /** Sections that would print empty, so they can be flagged in the list. */
  emptySections: PrintSection[];
}

interface SectionChoice {
  key: PrintSection;
  label: string;
  hint: string;
  /** True when this section is scoped to the chosen date rather than all time. */
  dateScoped: boolean;
}

const SECTIONS: readonly SectionChoice[] = [
  {
    key: 'daily',
    label: 'Daily summary',
    hint: 'Totals and a per-crusher table for one date',
    dateScoped: true,
  },
  {
    key: 'rent',
    label: 'Vehicle rent',
    hint: 'Rent owed per vehicle on one date',
    dateScoped: true,
  },
  {
    key: 'crusher',
    label: 'Crusher-wise',
    hint: 'All-time totals per crusher',
    dateScoped: false,
  },
  {
    key: 'monthly',
    label: 'Monthly',
    hint: 'Quantity, discount and profit per month',
    dateScoped: false,
  },
];

/**
 * Pick which report sections go into the printout before opening the browser's
 * print dialog (where "Save as PDF" is the usual destination).
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
        @for (section of sections; track section.key) {
          <div>
            <mat-checkbox
              [checked]="isChecked(section.key)"
              (change)="toggle(section.key, $event.checked)"
              [attr.data-testid]="'print-section-' + section.key"
            >
              {{ section.label }}
              @if (section.dateScoped) {
                <span class="text-[var(--text-soft)]">· {{ dateLabel }}</span>
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
  private readonly data = inject<PrintOptionsData>(MAT_DIALOG_DATA);

  protected readonly sections = SECTIONS;
  protected readonly dateLabel = formatDate(this.data.date);

  private readonly selected = signal<ReadonlySet<PrintSection>>(new Set(this.data.sections));
  protected readonly chosen = computed(() =>
    SECTIONS.filter((s) => this.selected().has(s.key)).map((s) => s.key),
  );

  protected isChecked(key: PrintSection): boolean {
    return this.selected().has(key);
  }

  protected isEmpty(key: PrintSection): boolean {
    return this.data.emptySections.includes(key);
  }

  protected toggle(key: PrintSection, checked: boolean): void {
    this.selected.update((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  protected confirm(): void {
    // Return sections in the canonical order, not the order they were ticked.
    this.dialogRef.close({ sections: this.chosen(), date: this.data.date });
  }
}
