import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { PARTY_PILLARS, PILLARS } from './app.routes';
import { PreferencesStore } from './core/preferences/preferences-store';
import { AccountsStore, type Account } from './core/accounts/accounts-store';
// Type-only: the dialog component itself stays in its own lazy chunk.
import type { AccountNameDialogData } from './shared/accounts/account-name-dialog';

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

  private readonly accountMenuTrigger = viewChild(MatMenuTrigger);

  /** Open the shared name prompt and resolve with the entered name, if any. */
  private async promptForName(data: AccountNameDialogData): Promise<string | undefined> {
    const { AccountNameDialog } = await import('./shared/accounts/account-name-dialog');
    const ref = this.dialog.open<unknown, typeof data, string>(AccountNameDialog, {
      width: '360px',
      data,
    });
    return new Promise((resolve) => {
      ref.afterClosed().subscribe((value) => resolve(value ?? undefined));
    });
  }

  /** Create a new, empty party book (named via a small prompt dialog). */
  protected async createAccount(): Promise<void> {
    const name = await this.promptForName({
      title: 'New party ledger',
      description: 'A separate book with its own parties, rates, vehicles and reports.',
      submitLabel: 'Create',
      testidPrefix: 'new-account',
    });
    if (!name) return;
    await this.accounts.createPartyAccount(name);
    await this.router.navigate(['/party/entry']);
    this.closeOnHandset();
  }

  /**
   * Rename any book from the switcher — including the two built-ins; only the
   * label changes, never the id or the data behind it.
   */
  protected async renameAccount(account: Account, event: Event): Promise<void> {
    // The pencil sits inside the switch row; don't also switch books.
    event.stopPropagation();
    this.accountMenuTrigger()?.closeMenu();
    const name = await this.promptForName({
      title: 'Rename book',
      initial: account.name,
      submitLabel: 'Rename',
      testidPrefix: 'rename-account',
    });
    if (!name || name === account.name) return;
    await this.accounts.rename(account.id, name);
  }
}
