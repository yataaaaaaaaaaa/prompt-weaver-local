// Griffel classes and icons of the semantic visual states and action intents, built from THE color table
// (src/ui/stateColors.ts). Views apply these classes (mergeClasses) and never pick state tokens themselves.
//
//   const surface = useStateSurfaceClasses();      // rows, chips, list items: border + tinted background + text
//   const frame = useStateFrameClasses();          // category cards: frame.card[state] (border) + frame.header[state]
//   const text = useStateTextClasses();            // text only: color, italic (indirectly disabled), line-through
//   const accent = useStateAccentClasses();        // icons, checked toggles: the accent color
//   const badge = useStateBadgeClasses();          // badges: accent outline and icon, readable text
//   const actions = useActionClasses();            // buttons: actions.filled.danger, actions.subtle.warning, ...
//   const Icon = STATE_ICONS[state];               // the non-color cue of a state
import { makeStyles, tokens, type GriffelStyle } from '@fluentui/react-components';
import {
	CheckmarkCircleRegular,
	CircleOffRegular,
	LinkRegular,
	LockClosedRegular,
	ProhibitedRegular,
	ShieldProhibitedRegular,
	SubtractCircleRegular,
	type FluentIcon,
} from '@fluentui/react-icons';
import {
	ACTION_COLORS,
	ACTION_INTENTS,
	STATE_COLORS,
	VISUAL_STATES,
	type ActionColors,
	type ActionIntent,
	type StateColors,
	type VisualState,
} from './stateColors';

/** The icon shown next to (never instead of) a state's color. */
export const STATE_ICONS: Readonly<Record<VisualState, FluentIcon>> = {
	forbiddenLocked: ShieldProhibitedRegular,
	forbidden: ProhibitedRegular,
	associated: LinkRegular,
	current: CheckmarkCircleRegular,
	locked: LockClosedRegular,
	indirectlyDisabled: CircleOffRegular,
	skipped: SubtractCircleRegular,
};

type StyleRule = GriffelStyle;

function byState(build: (colors: StateColors) => StyleRule): Record<VisualState, StyleRule> {
	return Object.fromEntries(VISUAL_STATES.map((state) => [state, build(STATE_COLORS[state])])) as Record<VisualState, StyleRule>;
}

function byIntent(build: (colors: ActionColors) => StyleRule): Record<ActionIntent, StyleRule> {
	return Object.fromEntries(ACTION_INTENTS.map((intent) => [intent, build(ACTION_COLORS[intent])])) as Record<ActionIntent, StyleRule>;
}

const ICON_SLOT = '& .fui-Button__icon';
/** The icon of the button the class is on, never of buttons inside it (a row's own Delete / Lock / Skip buttons). */
const OWN_ICON_SLOT = '& > .fui-Button__icon';
const BADGE_ICON_SLOT = '& > .fui-Badge__icon';

function borderColors(color: string): GriffelStyle {
	return { borderTopColor: color, borderRightColor: color, borderBottomColor: color, borderLeftColor: color };
}

// On buttons (chips), the state border and icon stay through hover / press and Fluent's checked styles: the state
// shows as soon as the chip is clicked, under the pointer (only the background gives the hover feedback).
const useSurfaceStyles = makeStyles(
	byState((colors) => ({
		border: `${tokens.strokeWidthThin} ${colors.borderStyle} ${colors.border}`,
		backgroundColor: colors.background,
		color: colors.foreground,
		[OWN_ICON_SLOT]: { color: colors.accent },
		':hover': { ...borderColors(colors.border), color: colors.foreground, [OWN_ICON_SLOT]: { color: colors.accent } },
		':hover:active': { ...borderColors(colors.border), color: colors.foreground, [OWN_ICON_SLOT]: { color: colors.accent } },
	})),
);

const useFrameCardStyles = makeStyles(
	byState((colors) => ({
		border: `${tokens.strokeWidthThick} ${colors.borderStyle} ${colors.border}`,
	})),
);

const useFrameHeaderStyles = makeStyles(
	byState((colors) => ({
		backgroundColor: colors.background,
		color: colors.foreground,
		borderBottom: `${tokens.strokeWidthThin} ${colors.borderStyle} ${colors.border}`,
	})),
);

const useTextStyles = makeStyles({
	...byState((colors) => ({ color: colors.foreground })),
	indirectlyDisabled: { color: STATE_COLORS.indirectlyDisabled.foreground, fontStyle: 'italic' },
	skipped: { color: STATE_COLORS.skipped.foreground, textDecorationLine: 'line-through' },
});

const useAccentStyles = makeStyles(
	byState((colors) => ({
		color: colors.accent,
		[ICON_SLOT]: { color: colors.accent },
		':hover': { color: colors.accent, [ICON_SLOT]: { color: colors.accent } },
	})),
);

// Filled buttons and checked toggles (a checked Fluent ToggleButton colors its icon slot itself: it is set too).
const useBadgeStyles = makeStyles(
	byState((colors) => ({
		...borderColors(colors.accent),
		color: colors.foreground,
		[BADGE_ICON_SLOT]: { color: colors.accent },
	})),
);

// Action intents color enabled buttons only: a disabled button (disabled, or disabledFocusable = aria-disabled) keeps
// Fluent's disabled look, so views apply the intent class whatever the button's state.
const ENABLED = '&:not(:disabled):not([aria-disabled="true"])';

const useFilledActionStyles = makeStyles(
	byIntent((colors) => ({
		[ENABLED]: {
			backgroundColor: colors.background,
			color: colors.foreground,
			...borderColors(colors.border),
			[ICON_SLOT]: { color: colors.foreground },
			':hover': { backgroundColor: colors.backgroundHover, color: colors.foreground, [ICON_SLOT]: { color: colors.foreground } },
			':hover:active': { backgroundColor: colors.backgroundPressed, color: colors.foreground, [ICON_SLOT]: { color: colors.foreground } },
		},
	})),
);

const useSubtleActionStyles = makeStyles(
	byIntent((colors) => ({
		[ENABLED]: {
			color: colors.subtleForeground,
			[ICON_SLOT]: { color: colors.subtleForeground },
			':hover': {
				backgroundColor: colors.subtleBackgroundHover,
				color: colors.subtleForeground,
				[ICON_SLOT]: { color: colors.subtleForeground },
			},
			':hover:active': {
				backgroundColor: colors.subtleBackgroundHover,
				color: colors.subtleForeground,
				[ICON_SLOT]: { color: colors.subtleForeground },
			},
		},
	})),
);

/** Rows, chips, list items: border (dashed when the state says so), tinted background, text color. */
export function useStateSurfaceClasses(): Record<VisualState, string> {
	return useSurfaceStyles();
}

/** Category cards of the prompt board (their category's state): `card` for the frame border, `header` for the tinted
 *  header. */
export function useStateFrameClasses(): { card: Record<VisualState, string>; header: Record<VisualState, string> } {
	return { card: useFrameCardStyles(), header: useFrameHeaderStyles() };
}

/** Text only: color, plus italic (indirectly disabled) and line-through (skipped). */
export function useStateTextClasses(): Record<VisualState, string> {
	return useTextStyles();
}

/** Icons and checked toggle buttons: the state's accent color (also on a Fluent Button's icon slot). */
export function useStateAccentClasses(): Record<VisualState, string> {
	return useAccentStyles();
}

/** Badges (appearance="outline") marking a state: the accent outline and icon (graphics, 3:1), text in the state's
 *  readable foreground (4.5:1). */
export function useStateBadgeClasses(): Record<VisualState, string> {
	return useBadgeStyles();
}

/** Buttons by intent: `filled` for appearance="primary"/"secondary" buttons and checked toggles that must stand out
 *  (an active Skip: filled warning), `subtle` for subtle / icon buttons. Pass the class as the Button's className,
 *  whatever the button's state: a disabled button keeps Fluent's disabled look. */
export function useActionClasses(): { filled: Record<ActionIntent, string>; subtle: Record<ActionIntent, string> } {
	return { filled: useFilledActionStyles(), subtle: useSubtleActionStyles() };
}
