import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../app/AppProviders';
import { ACTION_INTENTS, VISUAL_STATES } from './stateColors';
import {
	STATE_ICONS,
	useActionClasses,
	useStateAccentClasses,
	useStateBadgeClasses,
	useStateFrameClasses,
	useStateSurfaceClasses,
	useStateTextClasses,
} from './stateStyles';

function wrapper({ children }: { children: ReactNode }) {
	return <AppProviders colorScheme="light">{children}</AppProviders>;
}

describe('state styles', () => {
	it('builds one non-empty class per visual state for every usage', () => {
		const { result } = renderHook(
			() => ({
				surface: useStateSurfaceClasses(),
				frame: useStateFrameClasses(),
				text: useStateTextClasses(),
				accent: useStateAccentClasses(),
				badge: useStateBadgeClasses(),
			}),
			{ wrapper },
		);
		for (const state of VISUAL_STATES) {
			for (const classes of [
				result.current.surface,
				result.current.frame.card,
				result.current.frame.header,
				result.current.text,
				result.current.accent,
				result.current.badge,
			]) {
				expect(classes[state]).toMatch(/\S/);
			}
		}
		expect(new Set(VISUAL_STATES.map((state) => result.current.surface[state])).size).toBe(VISUAL_STATES.length);
	});

	it('builds filled and subtle classes per action intent', () => {
		const { result } = renderHook(() => useActionClasses(), { wrapper });
		for (const intent of ACTION_INTENTS) {
			expect(result.current.filled[intent]).toMatch(/\S/);
			expect(result.current.subtle[intent]).toMatch(/\S/);
		}
	});

	it('colors enabled buttons only: a disabled button keeps the Fluent disabled look', () => {
		const { result } = renderHook(() => useActionClasses(), { wrapper });
		const css = Array.from(document.styleSheets)
			.flatMap((sheet) => Array.from(sheet.cssRules))
			.map((rule) => rule.cssText);
		for (const variant of ['filled', 'subtle'] as const) {
			for (const intent of ACTION_INTENTS) {
				const atomic = result.current[variant][intent].split(/\s+/).filter((name) => name && !name.startsWith('___'));
				expect(atomic.length).toBeGreaterThan(0);
				for (const className of atomic) {
					const rules = css.filter((text) => text.includes(`.${className}`));
					expect(rules.length, `${variant} ${intent}: rules of .${className}`).toBeGreaterThan(0);
					for (const rule of rules) {
						expect(rule).toContain(`.${className}:not(:disabled):not([aria-disabled="true"])`);
					}
				}
			}
		}
	});

	it('has an icon for every visual state', () => {
		for (const state of VISUAL_STATES) {
			expect(STATE_ICONS[state]).toBeTruthy();
		}
	});
});
