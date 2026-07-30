import { computed, effect, inject, Injectable } from '@angular/core';
import { StorageService } from '../storage/storage.service';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Preferences {
  sidebarCollapsed: boolean;
  theme: ThemeMode;
  // Add app-specific UI preferences here (they persist alongside the rest).
}

export const DEFAULT_PREFERENCES: Preferences = {
  sidebarCollapsed: false,
  theme: 'system',
};

/**
 * UI preferences (sidebar collapsed state, theme) persisted via StorageService.
 * Applying the theme sets `html[data-theme]` (and `color-scheme`) on the document
 * root, which drives the design-token overrides in styles.scss; removing it
 * (system mode) lets the `prefers-color-scheme` media query decide.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesStore {
  private readonly store = inject(StorageService).bind<Preferences>({
    key: 'preferences',
    version: 1,
    defaults: DEFAULT_PREFERENCES,
    // On any future shape change, bump `version` and merge over defaults here:
    migrate: (data) => ({ ...DEFAULT_PREFERENCES, ...(data as Partial<Preferences>) }),
  });

  readonly value = this.store.value;
  readonly ready = this.store.ready;
  readonly sidebarCollapsed = computed(() => this.value().sidebarCollapsed);
  readonly theme = computed(() => this.value().theme);

  constructor() {
    effect(() => {
      const theme = this.theme();
      const root = document.documentElement;
      if (theme === 'system') {
        root.removeAttribute('data-theme');
        root.style.removeProperty('color-scheme');
      } else {
        root.setAttribute('data-theme', theme);
        root.style.colorScheme = theme;
      }
    });
  }

  toggleSidebar(): void {
    this.store.patch({ sidebarCollapsed: !this.value().sidebarCollapsed });
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.store.patch({ sidebarCollapsed: collapsed });
  }

  setTheme(theme: ThemeMode): void {
    this.store.patch({ theme });
  }
}
