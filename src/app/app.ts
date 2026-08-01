import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { PARTY_PILLARS, PILLARS } from './app.routes';
import { PreferencesStore } from './core/preferences/preferences-store';
import { AccountsStore, type Account } from './core/accounts/accounts-store';

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
  private readonly router = inject(Router);
  protected readonly accounts = inject(AccountsStore);

  /** The active book's tab set — the sidebar swaps wholesale on switch. */
  protected readonly pillars = computed(() =>
    this.accounts.active().type === 'party' ? PARTY_PILLARS : PILLARS,
  );
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

  /**
   * Switch books, then land on the target book's first tab. Awaits the switch
   * so the choice is durable before any page derives state from it.
   */
  protected async switchAccount(account: Account): Promise<void> {
    if (account.id === this.accounts.active().id) return;
    await this.accounts.setActive(account.id);
    const [home] = account.type === 'party' ? PARTY_PILLARS : PILLARS;
    await this.router.navigate(['/', ...home.path.split('/')]);
    this.closeOnHandset();
  }

  /** Create a new, empty party book (named via a small prompt dialog). */
  protected async createAccount(): Promise<void> {
    const { NewAccountDialog } = await import('./features/party/new-account-dialog');
    const ref = this.dialog.open<unknown, void, string>(NewAccountDialog, { width: '360px' });
    const name = await new Promise<string | undefined>((resolve) => {
      ref.afterClosed().subscribe((value) => resolve(value ?? undefined));
    });
    if (!name?.trim()) return;
    await this.accounts.createPartyAccount(name);
    await this.router.navigate(['/party/entry']);
    this.closeOnHandset();
  }
}
