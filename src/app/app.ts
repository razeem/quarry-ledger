import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { PILLARS } from './app.routes';
import { PreferencesStore } from './core/preferences/preferences-store';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly prefs = inject(PreferencesStore);
  private readonly dialog = inject(MatDialog);

  protected readonly pillars = PILLARS;
  protected readonly collapsed = this.prefs.sidebarCollapsed;
  protected readonly theme = this.prefs.theme;

  /** On handset/tablet the sidenav is an overlay controlled by `mobileOpen`. */
  protected readonly isHandset = toSignal(
    this.breakpoints
      .observe([Breakpoints.Handset, Breakpoints.TabletPortrait])
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );
  protected readonly mobileOpen = signal(false);

  constructor() {
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-rounded');
  }

  protected toggleSidebar(): void {
    if (this.isHandset()) {
      this.mobileOpen.update((open) => !open);
    } else {
      this.prefs.toggleSidebar();
    }
  }

  protected closeOnHandset(): void {
    if (this.isHandset()) {
      this.mobileOpen.set(false);
    }
  }

  protected cycleTheme(): void {
    const order = ['system', 'light', 'dark'] as const;
    const next = order[(order.indexOf(this.theme()) + 1) % order.length];
    this.prefs.setTheme(next);
  }

  protected async openSettings(): Promise<void> {
    // Lazy-load the settings dialog (and its heavier deps) on demand.
    const { SettingsDialog } = await import('./features/settings/settings-dialog');
    this.dialog.open(SettingsDialog, { autoFocus: false, restoreFocus: false });
  }
}
