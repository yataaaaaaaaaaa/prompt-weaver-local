import { webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DARK_COLOR_SCHEME_QUERY, themeFor, useAppTheme } from './theme';

/** A controllable MediaQueryList for (prefers-color-scheme: dark). */
function installColorScheme(initiallyDark: boolean) {
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const query = {
		matches: initiallyDark,
		media: DARK_COLOR_SCHEME_QUERY,
		onchange: null,
		addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
		removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
		addListener: () => undefined,
		removeListener: () => undefined,
		dispatchEvent: () => false,
	};
	const matchMedia = vi.fn(() => query as unknown as MediaQueryList);
	vi.stubGlobal('matchMedia', matchMedia);
	return {
		query,
		matchMedia,
		listeners,
		setDark(dark: boolean) {
			query.matches = dark;
			listeners.forEach((listener) => listener({ matches: dark } as MediaQueryListEvent));
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('useAppTheme', () => {
	it('uses the Fluent web light theme when the OS prefers light', () => {
		const scheme = installColorScheme(false);
		const { result } = renderHook(() => useAppTheme());
		expect(result.current).toBe(webLightTheme);
		expect(scheme.matchMedia).toHaveBeenCalledWith(DARK_COLOR_SCHEME_QUERY);
	});

	it('uses the Fluent web dark theme when the OS prefers dark', () => {
		installColorScheme(true);
		const { result } = renderHook(() => useAppTheme());
		expect(result.current).toBe(webDarkTheme);
	});

	it('follows live color scheme changes and unsubscribes on unmount', () => {
		const scheme = installColorScheme(false);
		const { result, unmount } = renderHook(() => useAppTheme());

		act(() => scheme.setDark(true));
		expect(result.current).toBe(webDarkTheme);

		act(() => scheme.setDark(false));
		expect(result.current).toBe(webLightTheme);

		unmount();
		expect(scheme.listeners.size).toBe(0);
	});

	it('maps the dark flag to the Fluent themes', () => {
		expect(themeFor(true)).toBe(webDarkTheme);
		expect(themeFor(false)).toBe(webLightTheme);
	});
});
