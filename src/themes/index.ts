// Theme registry: a theme is data, not layout.
// Colors live in src/styles/site.css under [data-theme="<id>"].

export const THEMES = {
	chandelure: { label: 'Chandelure', scheme: 'dark' },
	kazuha: { label: 'Kazuha', scheme: 'light' },
} as const;

export type ThemeId = keyof typeof THEMES;

export const STORAGE_KEY = 'theme';

// Theme used when the visitor hasn't picked one, based on their OS setting.
export const DEFAULT_THEME: Record<'dark' | 'light', ThemeId> = {
	dark: 'chandelure',
	light: 'kazuha',
};

export function isThemeId(value: unknown): value is ThemeId {
	return typeof value === 'string' && value in THEMES;
}

function osTheme(): ThemeId {
	return matchMedia('(prefers-color-scheme: dark)').matches ? DEFAULT_THEME.dark : DEFAULT_THEME.light;
}

export function getStoredTheme(): ThemeId | null {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return isThemeId(v) ? v : null;
	} catch {
		return null;
	}
}

/** Apply a theme. Pass null to go back to "auto" (follow the OS). */
export function setTheme(id: ThemeId | null) {
	try {
		if (id) localStorage.setItem(STORAGE_KEY, id);
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* storage blocked: theme still applies for this page view */
	}
	document.documentElement.dataset.theme = id ?? osTheme();
}

/** While in auto mode, follow OS light/dark changes live. */
export function watchOsTheme() {
	matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
		if (!getStoredTheme()) document.documentElement.dataset.theme = osTheme();
	});
}
