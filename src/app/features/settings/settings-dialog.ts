import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { PreferencesStore, ThemeMode } from '../../core/preferences/preferences-store';
import { DataTransfer } from './data-transfer';

/**
 * Settings dialog: tabbed. Ships with Preferences (theme) + Transfer data.
 * Add tabs (e.g. a profile form, app-specific rules) by importing their
 * components and adding a <mat-tab>.
 */
@Component({
  selector: 'app-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatTabsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    DataTransfer,
  ],
  template: `
    <div class="head">
      <h2 mat-dialog-title>Settings</h2>
      <button mat-icon-button mat-dialog-close aria-label="Close">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <mat-dialog-content>
      <mat-tab-group animationDuration="200ms">
        <mat-tab label="Preferences">
          <div class="pane">
            <section class="pref">
              <div class="pref__label">
                <span class="pref__title">Theme</span>
                <span class="pref__help">Follow your system, or force light/dark.</span>
              </div>
              <mat-button-toggle-group
                [value]="prefs.theme()"
                (change)="setTheme($event.value)"
                data-testid="theme-toggle"
              >
                <mat-button-toggle value="system">
                  <mat-icon>brightness_auto</mat-icon>
                </mat-button-toggle>
                <mat-button-toggle value="light"><mat-icon>light_mode</mat-icon></mat-button-toggle>
                <mat-button-toggle value="dark"><mat-icon>dark_mode</mat-icon></mat-button-toggle>
              </mat-button-toggle-group>
            </section>
          </div>
        </mat-tab>
        <mat-tab label="Transfer data">
          <div class="pane">
            <app-data-transfer />
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.5rem 0 1.25rem;
    }
    .head h2 {
      margin: 0;
    }
    mat-dialog-content {
      width: min(560px, 92vw);
      padding-top: 0.5rem;
    }
    .pane {
      padding: 1.25rem 0.25rem 0.5rem;
    }
    .pref {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .pref + .pref {
      margin-top: 1.25rem;
    }
    .pref__title {
      display: block;
      font-weight: 600;
    }
    .pref__help {
      font-size: 0.82rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class SettingsDialog {
  protected readonly prefs = inject(PreferencesStore);

  protected setTheme(theme: ThemeMode): void {
    this.prefs.setTheme(theme);
  }
}
