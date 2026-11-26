// THE single owner of the app's semantic state colors: every semantic visual state (the states of prompts, of
// category cards and of the Used sub-prompts list) and every action intent (primary / danger / warning buttons)
// mapped to Fluent 2 palette, status and brand tokens. Views never pick these tokens themselves: they use the
// classes of src/ui/stateStyles.tsx (built from this table), and the e2e suite (frontend/e2e) reads this table to
// check the colors the real browser computes.
//
// Pure data (only @fluentui/react-theme tokens, which are CSS variable references such as
// `var(--colorPaletteRedBorder2)`), so the Node-side e2e tests can import it. Both themes resolve the same tokens.
//
// Color is never the only cue: every state also has a label (tooltips, aria descriptions), an icon
// (stateStyles.tsx STATE_ICONS) and, for some, a border style (dashed) or text decoration.
//
// Contrast (checked in the real browser by e2e/categories, dark and light): `foreground` on `background` is at least
// 4.5:1; the `border` of every highlighted state (all but skipped, whose border is the neutral card stroke) and every
// `accent` are at least 3:1 against `background` and the window surface (colorNeutralBackground1).
import { tokens } from '@fluentui/react-theme';

/** Semantic visual states, strongest first: when several apply to one element, the first one is shown. */
export const VISUAL_STATES = [
	'forbiddenLocked',
	'forbidden',
	'associated',
	'current',
	'locked',
	'indirectlyDisabled',
	'skipped',
] as const;

/**
 * - forbiddenLocked: forbidden together with the association source, and a locked prompt is involved (purple);
 * - forbidden: forbidden together with the association source (red);
 * - associated: the association source picked in the Used sub-prompts list (green): what the next pick associates;
 * - current: used by the output being viewed (brand blue);
 * - locked: a locked sub-prompt, always selected (purple accent);
 * - indirectlyDisabled: can never be selected (activation text, locks, forbidden rules) (amber, dashed);
 * - skipped: skipped by the user (muted).
 */
export type VisualState = (typeof VISUAL_STATES)[number];

export type StateColors = {
	/** Border of the element (row, chip, window frame). */
	border: string;
	borderStyle: 'solid' | 'dashed';
	/** Tinted surface (rows, chips, window header). */
	background: string;
	/** Text on `background`. */
	foreground: string;
	/** Strong accent: window frame stripe, state icon, toggle checked color. */
	accent: string;
	/** Text cue (tooltips, aria descriptions): color is never the only cue. */
	label: string;
};

export const STATE_COLORS: Readonly<Record<VisualState, StateColors>> = {
	forbiddenLocked: {
		border: tokens.colorPalettePurpleBorderActive,
		borderStyle: 'solid',
		background: tokens.colorPalettePurpleBackground2,
		foreground: tokens.colorNeutralForeground1,
		// The saturated purple of both themes (Foreground2 is near-black in light, pale lavender in dark).
		accent: tokens.colorPalettePurpleBorderActive,
		label: 'Forbidden by a locked prompt',
	},
	forbidden: {
		border: tokens.colorPaletteRedBorder2,
		borderStyle: 'solid',
		background: tokens.colorPaletteRedBackground1,
		foreground: tokens.colorNeutralForeground1,
		accent: tokens.colorPaletteRedForeground1,
		label: 'Forbidden with the association source',
	},
	associated: {
		border: tokens.colorPaletteGreenBorder2,
		borderStyle: 'solid',
		background: tokens.colorPaletteGreenBackground1,
		foreground: tokens.colorNeutralForeground1,
		accent: tokens.colorPaletteGreenForeground1,
		label: 'Association source',
	},
	current: {
		border: tokens.colorBrandStroke1,
		borderStyle: 'solid',
		background: tokens.colorBrandBackground2,
		foreground: tokens.colorNeutralForeground1,
		accent: tokens.colorBrandForeground1,
		label: 'Used by the current output',
	},
	locked: {
		border: tokens.colorPalettePurpleBorderActive,
		borderStyle: 'solid',
		background: tokens.colorNeutralBackground1,
		foreground: tokens.colorNeutralForeground1,
		// The checked Lock toggle: at least 3:1 on every row surface and on the selected toggle background.
		accent: tokens.colorPalettePurpleBorderActive,
		label: 'Locked: always selected',
	},
	indirectlyDisabled: {
		// Marigold Border2 is under 3:1 on white in the light theme; Foreground2 is the accessible amber of both themes.
		border: tokens.colorPaletteMarigoldForeground2,
		borderStyle: 'dashed',
		background: tokens.colorPaletteMarigoldBackground1,
		foreground: tokens.colorNeutralForeground2,
		accent: tokens.colorPaletteMarigoldForeground2,
		label: 'Indirectly disabled: it can never be selected',
	},
	skipped: {
		border: tokens.colorNeutralStroke2,
		borderStyle: 'solid',
		background: tokens.colorNeutralBackground3,
		// Muted but readable (at least 4.5:1): skipped prompts stay editable. The line-through is the non-color cue.
		foreground: tokens.colorNeutralForeground3,
		accent: tokens.colorNeutralForeground3,
		label: 'Skipped',
	},
};

/** The strongest of `states` (VISUAL_STATES order); null when none applies. */
export function strongestVisualState(states: Iterable<VisualState | null | undefined | false>): VisualState | null {
	let best: VisualState | null = null;
	for (const state of states) {
		if (state && (best === null || VISUAL_STATES.indexOf(state) < VISUAL_STATES.indexOf(best))) {
			best = state;
		}
	}
	return best;
}

/** Action intents of buttons: primary = brand (Generate, Save), danger = red (Delete, Remove, Trash), warning =
 *  amber (actions that change what generation uses without deleting, e.g. an active Skip toggle). */
export const ACTION_INTENTS = ['primary', 'danger', 'warning'] as const;
export type ActionIntent = (typeof ACTION_INTENTS)[number];

export type ActionColors = {
	/** Filled button (and checked toggle, e.g. an active Skip). */
	background: string;
	backgroundHover: string;
	backgroundPressed: string;
	foreground: string;
	/** Border of the filled button: transparent unless the fill alone is under 3:1 against the window surface. */
	border: string;
	/** Subtle / icon button (and checked toggle) foreground, and its hover surface. */
	subtleForeground: string;
	subtleBackgroundHover: string;
};

export const ACTION_COLORS: Readonly<Record<ActionIntent, ActionColors>> = {
	primary: {
		background: tokens.colorBrandBackground,
		backgroundHover: tokens.colorBrandBackgroundHover,
		backgroundPressed: tokens.colorBrandBackgroundPressed,
		foreground: tokens.colorNeutralForegroundOnBrand,
		border: tokens.colorTransparentStroke,
		subtleForeground: tokens.colorBrandForeground1,
		subtleBackgroundHover: tokens.colorBrandBackground2,
	},
	danger: {
		background: tokens.colorStatusDangerBackground3,
		backgroundHover: tokens.colorStatusDangerBackground3Hover,
		backgroundPressed: tokens.colorStatusDangerBackground3Pressed,
		foreground: tokens.colorNeutralForegroundOnBrand,
		border: tokens.colorTransparentStroke,
		subtleForeground: tokens.colorStatusDangerForeground1,
		subtleBackgroundHover: tokens.colorStatusDangerBackground1,
	},
	warning: {
		background: tokens.colorPaletteMarigoldBackground3,
		backgroundHover: tokens.colorPaletteMarigoldBorder2,
		backgroundPressed: tokens.colorPaletteMarigoldBorderActive,
		// Dark static text: white on amber fails contrast in both themes.
		foreground: tokens.colorNeutralForeground1Static,
		// The amber fill is 2.2:1 on white: the accessible amber outlines it (light theme).
		border: tokens.colorPaletteMarigoldForeground2,
		subtleForeground: tokens.colorPaletteMarigoldForeground2,
		subtleBackgroundHover: tokens.colorPaletteMarigoldBackground1,
	},
};
