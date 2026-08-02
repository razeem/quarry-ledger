import { Routes } from '@angular/router';

export type PillarStatus = 'active' | 'soon';

/** A top-level section of the app. Drives BOTH the sidebar and the router. */
export interface Pillar {
  path: string;
  title: string;
  icon: string; // Material Symbols name
  description: string;
  status: PillarStatus;
}

/**
 * Single source of truth for the app's tabs — the sidebar renders this and the
 * lazy routes below map onto it. Add a section here plus a matching
 * `loadComponent` route; the nav picks it up automatically.
 *
 * Each account type has its own tab set: `PILLARS` for the daily book,
 * `PARTY_PILLARS` for party books. The shell renders whichever matches the
 * active account (see `App.pillars`).
 */
export const PILLARS: Pillar[] = [
  {
    path: 'entry',
    title: 'Entry',
    icon: 'add_circle',
    description: 'Log a rock load in under ten seconds.',
    status: 'active',
  },
  {
    path: 'ledger',
    title: 'Ledger',
    icon: 'receipt_long',
    description: 'The daily ledger — the single source of truth.',
    status: 'active',
  },
  {
    path: 'reports',
    title: 'Reports',
    icon: 'insights',
    description: 'Daily, vehicle rent, crusher-wise and monthly summaries.',
    status: 'active',
  },
  {
    path: 'settings',
    title: 'Settings',
    icon: 'tune',
    description: 'Rate chart, vehicles, export and import.',
    status: 'active',
  },
];

/** Tabs for a party book (per-party rates, owner rent, profit splits). */
export const PARTY_PILLARS: Pillar[] = [
  {
    path: 'party/entry',
    title: 'Entry',
    icon: 'add_circle',
    description: 'Log a load against a party.',
    status: 'active',
  },
  {
    path: 'party/ledger',
    title: 'Ledger',
    icon: 'receipt_long',
    description: 'Every load across every party — filter, page, edit.',
    status: 'active',
  },
  {
    path: 'party/statements',
    title: 'Statements',
    icon: 'account_balance',
    description: 'Per-party payable, receivable, rent and profit.',
    status: 'active',
  },
  {
    path: 'party/reports',
    title: 'Reports',
    icon: 'insights',
    description: 'Cross-party summary and owner rent.',
    status: 'active',
  },
  {
    path: 'party/setup',
    title: 'Setup',
    icon: 'tune',
    description: 'Party rates, profit splits and vehicles.',
    status: 'active',
  },
];

export const routes: Routes = [
  // Entry is the landing tab: fast entry at the quarry is the app's main job.
  { path: '', pathMatch: 'full', redirectTo: 'entry' },
  {
    path: 'entry',
    title: 'Entry · Quarry Ledger',
    loadComponent: () => import('./features/entry/entry').then((m) => m.Entry),
  },
  {
    path: 'ledger',
    title: 'Ledger · Quarry Ledger',
    loadComponent: () => import('./features/ledger/ledger').then((m) => m.Ledger),
  },
  {
    path: 'reports',
    title: 'Reports · Quarry Ledger',
    loadComponent: () => import('./features/reports/reports').then((m) => m.Reports),
  },
  {
    path: 'settings',
    title: 'Settings · Quarry Ledger',
    loadComponent: () =>
      import('./features/settings/ledger-settings').then((m) => m.LedgerSettingsPage),
  },
  {
    path: 'party/entry',
    title: 'Party Entry · Quarry Ledger',
    loadComponent: () => import('./features/party/party-entry').then((m) => m.PartyEntry),
  },
  {
    path: 'party/ledger',
    title: 'Party Ledger · Quarry Ledger',
    loadComponent: () => import('./features/party/party-ledger').then((m) => m.PartyLedger),
  },
  {
    path: 'party/statements',
    title: 'Statements · Quarry Ledger',
    loadComponent: () =>
      import('./features/party/party-statements').then((m) => m.PartyStatements),
  },
  {
    path: 'party/reports',
    title: 'Party Reports · Quarry Ledger',
    loadComponent: () => import('./features/party/party-reports').then((m) => m.PartyReports),
  },
  {
    path: 'party/setup',
    title: 'Party Setup · Quarry Ledger',
    loadComponent: () => import('./features/party/party-setup').then((m) => m.PartySetup),
  },
  { path: '**', redirectTo: 'entry' },
];
