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
  { path: '**', redirectTo: 'entry' },
];
