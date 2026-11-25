import { tokens } from '@fluentui/react-theme';
import { describe, expect, it } from 'vitest';
import { ACTION_COLORS, ACTION_INTENTS, STATE_COLORS, VISUAL_STATES, strongestVisualState, type VisualState } from './stateColors';

const TOKEN_VALUES = new Set<string>(Object.values(tokens));

describe('STATE_COLORS', () => {
	it('maps every visual state to Fluent tokens only, with a text cue', () => {
		for (const state of VISUAL_STATES) {
			const { border, background, foreground, accent, label } = STATE_COLORS[state];
			for (const value of [border, background, foreground, accent]) {
				expect(TOKEN_VALUES.has(value), `${state}: ${value}`).toBe(true);
			}
			expect(label.trim()).not.toBe('');
		}
	});

	it('gives the highlighted states distinct borders (red, purple, green, brand, amber)', () => {
		const highlighted: VisualState[] = ['forbidden', 'forbiddenLocked', 'associated', 'current', 'indirectlyDisabled'];
		const borders = highlighted.map((state) => STATE_COLORS[state].border);
		expect(new Set(borders).size).toBe(highlighted.length);
		expect(STATE_COLORS.forbidden.border).toBe(tokens.colorPaletteRedBorder2);
		expect(STATE_COLORS.current.border).toBe(tokens.colorBrandStroke1);
	});

	it('uses the accessible variants where the plain palette token fails contrast in a theme', () => {
		// Marigold Border2 is 2.1:1 on white: the dashed amber border uses the accessible amber of both themes.
		expect(STATE_COLORS.indirectlyDisabled.border).toBe(tokens.colorPaletteMarigoldForeground2);
		// Skipped text stays readable (the disabled foreground is under 3:1).
		expect(STATE_COLORS.skipped.foreground).toBe(tokens.colorNeutralForeground3);
		// The saturated purple of both themes for the lock accents (Foreground2 is near-black in light).
		expect(STATE_COLORS.locked.accent).toBe(tokens.colorPalettePurpleBorderActive);
		expect(STATE_COLORS.forbiddenLocked.accent).toBe(tokens.colorPalettePurpleBorderActive);
	});

	it('marks indirectly disabled with a dashed border (not only a color)', () => {
		expect(STATE_COLORS.indirectlyDisabled.borderStyle).toBe('dashed');
		expect(VISUAL_STATES.filter((state) => STATE_COLORS[state].borderStyle === 'dashed')).toEqual(['indirectlyDisabled']);
	});
});

describe('strongestVisualState', () => {
	it('returns the first state of VISUAL_STATES among the given ones', () => {
		expect(strongestVisualState(['skipped', 'forbidden', 'current'])).toBe('forbidden');
		expect(strongestVisualState(['indirectlyDisabled', 'forbiddenLocked'])).toBe('forbiddenLocked');
		expect(strongestVisualState(['associated', 'current'])).toBe('associated');
	});

	it('ignores empty entries and returns null when no state applies', () => {
		expect(strongestVisualState([null, undefined, false])).toBeNull();
		expect(strongestVisualState([])).toBeNull();
		expect(strongestVisualState([false, 'skipped'])).toBe('skipped');
	});
});

describe('ACTION_COLORS', () => {
	it('maps every intent to Fluent tokens only', () => {
		for (const intent of ACTION_INTENTS) {
			for (const value of Object.values(ACTION_COLORS[intent])) {
				expect(TOKEN_VALUES.has(value), `${intent}: ${value}`).toBe(true);
			}
		}
		expect(ACTION_COLORS.primary.background).toBe(tokens.colorBrandBackground);
		expect(ACTION_COLORS.danger.background).toBe(tokens.colorStatusDangerBackground3);
	});

	it('outlines only the filled warning (its amber fill is under 3:1 on white)', () => {
		expect(ACTION_COLORS.warning.border).toBe(tokens.colorPaletteMarigoldForeground2);
		expect(ACTION_COLORS.primary.border).toBe(tokens.colorTransparentStroke);
		expect(ACTION_COLORS.danger.border).toBe(tokens.colorTransparentStroke);
	});
});
