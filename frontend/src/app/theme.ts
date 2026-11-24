// Theme: the Fluent 2 web themes, chosen from the OS color scheme with live updates.
// Single owner of the app theme choice (the Electron window background reads the same Fluent themes).
import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';
import { useSyncExternalStore } from 'react';

export const DARK_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function darkSchemeQuery(): MediaQueryList | null {
	return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_COLOR_SCHEME_QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
	const query = darkSchemeQuery();
	if (!query) {
		return () => undefined;
	}
	query.addEventListener('change', onChange);
	return () => query.removeEventListener('change', onChange);
}

function prefersDark(): boolean {
	return darkSchemeQuery()?.matches ?? false;
}

/** True while the OS asks for a dark color scheme (updates live). */
export function usePrefersDarkColorScheme(): boolean {
	return useSyncExternalStore(subscribe, prefersDark, () => false);
}

export function themeFor(dark: boolean): Theme {
	return dark ? webDarkTheme : webLightTheme;
}

/** The Fluent 2 web theme matching the OS color scheme. */
export function useAppTheme(): Theme {
	return themeFor(usePrefersDarkColorScheme());
}
