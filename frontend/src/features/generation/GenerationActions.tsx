// THE generation action buttons: Generate, Continuous and Cancel, for the generation panel's sticky action area
// (labelled buttons in a row that wraps) and for the collapsed generation strip (`compact`: icon-only buttons stacked
// vertically). One component, so both places always offer the same actions with the same names, states and intents.
//
// Action intents (src/ui/stateColors.ts): Generate is the primary action; Cancel is a warning action (it interrupts what
// is running without deleting anything); a running continuous loop shows the checked toggle in the primary color. A
// disabled button keeps the Fluent disabled look (the intent classes color enabled buttons only). The accessible names
// are the plain action names; the tooltips add what the action does and its shortcut (aria-keyshortcuts too).
import { Button, makeStyles, mergeClasses, ToggleButton, tokens, Tooltip } from '@fluentui/react-components';
import { ArrowRepeatAll20Regular, Dismiss20Regular, Sparkle20Regular } from '@fluentui/react-icons';
import type { AppCommand } from '../../app/commands';
import { useCanGenerate, useCanToggleContinuous, useGenerationStore } from '../../stores/generationStore';
import { ariaKeyShortcuts, withShortcut } from '../../ui/keyboard';
import { useActionClasses } from '../../ui/stateStyles';
import { GENERATION_ACTION_NAMES } from './generationLabels';

const useStyles = makeStyles({
	row: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	// Every button grows: one row when they fit, else Generate alone on the first row and the others sharing the second.
	rowButton: {
		flexGrow: 1,
	},
	generate: {
		flexGrow: 2,
	},
	column: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalS,
	},
});

/** The Generate button's label: its accessible name too. */
export function generateLabel(generating: boolean): string {
	return generating ? GENERATION_ACTION_NAMES.generating : GENERATION_ACTION_NAMES.generate;
}

type ActionTooltipProps = {
	text: string;
	command?: AppCommand;
	/** The compact strip sits at the right edge of the window: its tooltips open on the left. */
	compact: boolean;
	children: JSX.Element;
};

/** The visual hint of an action (the accessible name is the button's own label). */
function ActionTooltip({ text, command, compact, children }: ActionTooltipProps): JSX.Element {
	return (
		<Tooltip content={command ? withShortcut(text, command) : text} relationship="description" positioning={compact ? 'before' : 'above'}>
			{children}
		</Tooltip>
	);
}

export type GenerationActionsProps = {
	/** Icon-only buttons stacked vertically (the collapsed generation region). */
	compact?: boolean;
};

export function GenerationActions({ compact = false }: GenerationActionsProps): JSX.Element {
	const styles = useStyles();
	const actions = useActionClasses();
	const canGenerate = useCanGenerate();
	const canToggleContinuous = useCanToggleContinuous();
	const generating = useGenerationStore((state) => state.generating);
	const continuous = useGenerationStore((state) => state.continuous);
	const generate = useGenerationStore((state) => state.generate);
	const toggleContinuous = useGenerationStore((state) => state.toggleContinuous);
	const cancel = useGenerationStore((state) => state.cancel);
	const canCancel = generating || continuous;
	const generateName = generateLabel(generating);
	const buttonClass = compact ? undefined : styles.rowButton;
	// Icon-only buttons are named by aria-label; labelled ones by their text.
	const nameProps = (name: string) => (compact ? { 'aria-label': name } : {});
	const label = (name: string) => (compact ? undefined : name);

	return (
		<div className={compact ? styles.column : styles.row}>
			<ActionTooltip compact={compact} text="Generate one image with the current prompt and settings" command="generate">
				<Button
					appearance="primary"
					className={mergeClasses(buttonClass, !compact && styles.generate, actions.filled.primary)}
					icon={<Sparkle20Regular />}
					disabled={!canGenerate}
					aria-keyshortcuts={ariaKeyShortcuts('generate')}
					onClick={() => void generate()}
					{...nameProps(generateName)}
				>
					{label(generateName)}
				</Button>
			</ActionTooltip>
			<ActionTooltip compact={compact} text="Keep generating until you stop it" command="toggle-continuous-generate">
				<ToggleButton
					appearance={continuous ? 'primary' : 'secondary'}
					className={mergeClasses(buttonClass, continuous && actions.filled.primary)}
					icon={<ArrowRepeatAll20Regular />}
					checked={continuous}
					disabled={!canToggleContinuous}
					aria-keyshortcuts={ariaKeyShortcuts('toggle-continuous-generate')}
					onClick={() => void toggleContinuous()}
					{...nameProps(GENERATION_ACTION_NAMES.continuous)}
				>
					{label(GENERATION_ACTION_NAMES.continuous)}
				</ToggleButton>
			</ActionTooltip>
			<ActionTooltip compact={compact} text="Stop the running generation (nothing is deleted)">
				<Button
					appearance="subtle"
					className={mergeClasses(buttonClass, actions.subtle.warning)}
					icon={<Dismiss20Regular />}
					disabled={!canCancel}
					onClick={() => void cancel()}
					{...nameProps(GENERATION_ACTION_NAMES.cancel)}
				>
					{label(GENERATION_ACTION_NAMES.cancel)}
				</Button>
			</ActionTooltip>
		</div>
	);
}
