// The output actions of the viewer (a Fluent Toolbar named 'Output actions'; arrow keys move between its buttons): the
// output number and position, First / Previous / Next / Last, Copy prompt, Create character (prefilled from the output),
// Add to story (a menu of the stories: the output becomes a new scene), Undo, Delete (the red danger action: it moves the output to the app trash, Undo restores it) and the 'Output details'
// toggle of the details panel (layout store). Icon-only buttons named by their action; the tooltips add what they do and
// the keyboard shortcut (aria-keyshortcuts too). The toolbar wraps onto a second row in a narrow viewer.
// Thin view over the outputs, undo, characters, story and layout stores.
import { Body1Strong, Caption1, makeStyles, Toolbar, ToolbarButton, ToolbarDivider, ToolbarToggleButton, tokens, Tooltip } from '@fluentui/react-components';
import {
	ArrowNext20Regular,
	ArrowPrevious20Regular,
	ArrowUndo20Regular,
	ChevronLeft20Regular,
	ChevronRight20Regular,
	Copy20Regular,
	Delete20Regular,
	PanelBottom20Regular,
	PersonAdd20Regular,
} from '@fluentui/react-icons';
import type { ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AppCommand } from '../../app/commands';
import { useCharactersStore } from '../../stores/charactersStore';
import { AddToStoryButton } from '../story/AddToStoryButton';
import { useLayoutStore } from '../../stores/layoutStore';
import { selectNavigation, useOutputsStore } from '../../stores/outputsStore';
import { selectCanUndo, useUndoStore } from '../../stores/undoStore';
import { ariaKeyShortcuts, withShortcut } from '../../ui/keyboard';
import { useActionClasses } from '../../ui/stateStyles';
import { positionText } from './OutputDetailsList';
import { VIEWER_LABELS } from './viewerLabels';

const DETAILS_TOGGLE = { name: 'panels', value: 'details' } as const;

const useStyles = makeStyles({
	toolbar: {
		flexWrap: 'wrap',
		flexShrink: 0,
		rowGap: tokens.spacingVerticalXXS,
		minWidth: 0,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
	},
	position: {
		display: 'flex',
		alignItems: 'baseline',
		gap: tokens.spacingHorizontalS,
		paddingLeft: tokens.spacingHorizontalXS,
		paddingRight: tokens.spacingHorizontalS,
		whiteSpace: 'nowrap',
		fontVariantNumeric: 'tabular-nums',
	},
	count: {
		color: tokens.colorNeutralForeground3,
	},
	group: {
		display: 'flex',
		alignItems: 'center',
	},
	end: {
		marginLeft: 'auto',
	},
});

type ActionButtonProps = {
	label: string;
	/** Tooltip text (defaults to the label); the shortcut of `command` is appended. */
	hint?: string;
	icon: ReactElement;
	disabled: boolean;
	onClick: () => void;
	command?: AppCommand;
	className?: string;
};

/** An icon-only toolbar button: named `label`; the tooltip shows the hint and the shortcut. */
function ActionButton({ label, hint, icon, disabled, onClick, command, className }: ActionButtonProps): JSX.Element {
	const text = hint ?? label;
	return (
		<Tooltip content={command ? withShortcut(text, command) : text} relationship={hint ? 'description' : 'inaccessible'}>
			<ToolbarButton
				aria-label={label}
				className={className}
				appearance="subtle"
				icon={icon}
				disabled={disabled}
				aria-keyshortcuts={command ? ariaKeyShortcuts(command) : undefined}
				onClick={onClick}
			/>
		</Tooltip>
	);
}

export function OutputToolbar(): JSX.Element {
	const styles = useStyles();
	const actions = useActionClasses();
	const navigation = useOutputsStore(useShallow(selectNavigation));
	const currentId = useOutputsStore((state) => state.currentId);
	const hasPrompt = useOutputsStore((state) => Boolean(state.record?.prompt));
	const hasRecord = useOutputsStore((state) => state.record !== null);
	const first = useOutputsStore((state) => state.first);
	const previous = useOutputsStore((state) => state.previous);
	const next = useOutputsStore((state) => state.next);
	const last = useOutputsStore((state) => state.last);
	const deleteCurrent = useOutputsStore((state) => state.deleteCurrent);
	const copyCurrentPrompt = useOutputsStore((state) => state.copyCurrentPrompt);
	const startCreateFromOutput = useCharactersStore((state) => state.startCreateFromOutput);
	const canUndo = useUndoStore(selectCanUndo);
	const undo = useUndoStore((state) => state.undo);
	const detailsOpen = useLayoutStore((state) => state.details.open);
	const setDetailsOpen = useLayoutStore((state) => state.setDetailsOpen);
	const hasCurrent = navigation.index >= 0;

	return (
		<Toolbar
			aria-label={VIEWER_LABELS.outputActions}
			size="small"
			className={styles.toolbar}
			checkedValues={{ [DETAILS_TOGGLE.name]: detailsOpen ? [DETAILS_TOGGLE.value] : [] }}
			onCheckedValueChange={(_event, data) => {
				if (data.name === DETAILS_TOGGLE.name) {
					setDetailsOpen(data.checkedItems.includes(DETAILS_TOGGLE.value));
				}
			}}
		>
			<div className={styles.position}>
				{currentId !== null && hasCurrent ? <Body1Strong>#{currentId}</Body1Strong> : null}
				<Caption1 className={styles.count}>{positionText(navigation.index, navigation.count)}</Caption1>
			</div>
			<div className={styles.group}>
				<ActionButton label="First output" icon={<ArrowPrevious20Regular />} disabled={!navigation.canFirst} onClick={() => void first()} />
				<ActionButton
					label="Previous output"
					icon={<ChevronLeft20Regular />}
					disabled={!navigation.canPrevious}
					command="output-previous"
					onClick={() => void previous()}
				/>
				<ActionButton label="Next output" icon={<ChevronRight20Regular />} disabled={!navigation.canNext} command="output-next" onClick={() => void next()} />
				<ActionButton label="Last output" icon={<ArrowNext20Regular />} disabled={!navigation.canLast} onClick={() => void last()} />
			</div>
			<ToolbarDivider />
			<div className={styles.group}>
				<ActionButton label="Copy prompt" hint="Copy the full prompt of this output" icon={<Copy20Regular />} disabled={!hasPrompt} onClick={() => void copyCurrentPrompt()} />
				<ActionButton
					label="Create character"
					hint="New character prefilled with this output's tags, LoRAs and seed; its image becomes the reference"
					icon={<PersonAdd20Regular />}
					disabled={!hasRecord}
					onClick={() => startCreateFromOutput()}
				/>
				<AddToStoryButton />
				<ActionButton label="Undo" icon={<ArrowUndo20Regular />} disabled={!canUndo} command="undo" onClick={() => void undo()} />
				<ActionButton
					label="Delete"
					hint="Move to the app trash (Undo restores it)"
					className={actions.subtle.danger}
					icon={<Delete20Regular />}
					disabled={!hasCurrent}
					onClick={() => void deleteCurrent()}
				/>
			</div>
			<Tooltip content="Show or hide the output details and used sub-prompts" relationship="description">
				<ToolbarToggleButton
					className={styles.end}
					aria-label={VIEWER_LABELS.detailsToggle}
					appearance="subtle"
					icon={<PanelBottom20Regular />}
					name={DETAILS_TOGGLE.name}
					value={DETAILS_TOGGLE.value}
				/>
			</Tooltip>
		</Toolbar>
	);
}
