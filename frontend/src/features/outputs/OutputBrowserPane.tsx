// Output browser: first/previous/next/last/delete, generation progress and the metadata of the output
// being viewed. Thin view over the outputs store.
import {
	Body1,
	Button,
	buttonClassNames,
	Caption1,
	makeStyles,
	mergeClasses,
	Spinner,
	tokens,
	Tooltip,
} from '@fluentui/react-components';
import { ArrowNextRegular, ArrowPreviousRegular, ChevronLeftRegular, ChevronRightRegular, CopyRegular, DeleteRegular } from '@fluentui/react-icons';
import type { ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AppCommand } from '../../app/commands';
import { weightedLorasText } from '../../domain/loraSelection';
import { selectNavigation, useCurrentOutputDetails, useOutputsStore, type CurrentOutputDetails } from '../../stores/outputsStore';
import { ariaKeyShortcuts, withShortcut } from '../../ui/keyboard';
import { PaneContent } from '../../ui/PaneLayout';
import { GenerationProgress } from '../generation/GenerationProgress';

const useStyles = makeStyles({
	navigation: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXS,
	},
	delete: {
		marginLeft: 'auto',
	},
	danger: {
		color: tokens.colorStatusDangerForeground1,
		[`& .${buttonClassNames.icon}`]: {
			color: tokens.colorStatusDangerForeground1,
		},
		':hover': {
			color: tokens.colorStatusDangerForeground1,
			[`& .${buttonClassNames.icon}`]: {
				color: tokens.colorStatusDangerForeground1,
			},
		},
		':hover:active': {
			color: tokens.colorStatusDangerForeground1,
			[`& .${buttonClassNames.icon}`]: {
				color: tokens.colorStatusDangerForeground1,
			},
		},
	},
	hint: {
		color: tokens.colorNeutralForeground3,
	},
	details: {
		display: 'grid',
		gridTemplateColumns: 'max-content minmax(0, 1fr)',
		columnGap: tokens.spacingHorizontalL,
		rowGap: tokens.spacingVerticalXS,
		margin: 0,
	},
	row: {
		display: 'contents',
	},
	term: {
		color: tokens.colorNeutralForeground3,
		fontSize: tokens.fontSizeBase200,
		lineHeight: tokens.lineHeightBase300,
	},
	value: {
		margin: 0,
		fontSize: tokens.fontSizeBase300,
		lineHeight: tokens.lineHeightBase300,
		overflowWrap: 'anywhere',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
	actions: {
		display: 'flex',
	},
});

type NavigationButtonProps = {
	label: string;
	icon: ReactElement;
	disabled: boolean;
	onClick: () => void;
	command?: AppCommand;
};

function NavigationButton({ label, icon, disabled, onClick, command }: NavigationButtonProps): JSX.Element {
	return (
		<Tooltip content={command ? withShortcut(label, command) : label} relationship="label">
			<Button
				appearance="subtle"
				icon={icon}
				disabled={disabled}
				aria-keyshortcuts={command ? ariaKeyShortcuts(command) : undefined}
				onClick={onClick}
			/>
		</Tooltip>
	);
}

function DetailsList({ details, position }: { details: CurrentOutputDetails; position: string }): JSX.Element {
	const styles = useStyles();
	const rows: Array<[string, string]> = [
		['Output', `#${details.outputId}`],
		['Position', position],
		['Image name', details.imageName],
		['Size', `${details.width} × ${details.height}`],
		['Steps', String(details.steps)],
		['CFG', String(details.guidanceScale)],
		['Seed', String(details.seed)],
		['Prompt seed', details.promptSeed === null ? '—' : String(details.promptSeed)],
		['Model', details.modelName || '—'],
		['LoRAs', details.loras.length > 0 ? weightedLorasText(details.loras) : 'None'],
	];
	return (
		<dl className={styles.details} aria-label="Output details">
			{rows.map(([term, value]) => (
				<div key={term} className={styles.row}>
					<dt className={styles.term}>{term}</dt>
					<dd className={styles.value}>{value}</dd>
				</div>
			))}
		</dl>
	);
}

export function OutputBrowserPane(): JSX.Element {
	const styles = useStyles();
	const navigation = useOutputsStore(useShallow(selectNavigation));
	const loadingRecord = useOutputsStore((state) => state.loadingRecord);
	const first = useOutputsStore((state) => state.first);
	const previous = useOutputsStore((state) => state.previous);
	const next = useOutputsStore((state) => state.next);
	const last = useOutputsStore((state) => state.last);
	const deleteCurrent = useOutputsStore((state) => state.deleteCurrent);
	const copyCurrentPrompt = useOutputsStore((state) => state.copyCurrentPrompt);
	const details = useCurrentOutputDetails();
	const hasCurrent = navigation.index >= 0;
	const position = hasCurrent ? `${navigation.index + 1} / ${navigation.count}` : `— / ${navigation.count}`;

	return (
		<PaneContent>
			<div role="group" aria-label="Output navigation" className={styles.navigation}>
				<NavigationButton label="First output" icon={<ArrowPreviousRegular />} disabled={!navigation.canFirst} onClick={() => void first()} />
				<NavigationButton
					label="Previous output"
					icon={<ChevronLeftRegular />}
					disabled={!navigation.canPrevious}
					command="output-previous"
					onClick={() => void previous()}
				/>
				<NavigationButton label="Next output" icon={<ChevronRightRegular />} disabled={!navigation.canNext} command="output-next" onClick={() => void next()} />
				<NavigationButton label="Last output" icon={<ArrowNextRegular />} disabled={!navigation.canLast} onClick={() => void last()} />
				<Tooltip content="Move this output to the app trash (undo restores it)" relationship="description">
					<Button
						className={mergeClasses(styles.delete, hasCurrent && styles.danger)}
						icon={<DeleteRegular />}
						disabled={!hasCurrent}
						onClick={() => void deleteCurrent()}
					>
						Delete
					</Button>
				</Tooltip>
			</div>
			<Caption1 className={styles.hint}>
				Use the arrow keys to navigate the output folder. New generations always jump to the latest image.
			</Caption1>
			<GenerationProgress />
			{details ? (
				<DetailsList details={details} position={position} />
			) : loadingRecord ? (
				<Spinner size="tiny" label="Loading output details…" />
			) : (
				<Body1 className={styles.muted}>No output yet.</Body1>
			)}
			<div className={styles.actions}>
				<Button icon={<CopyRegular />} disabled={!details?.prompt} onClick={() => void copyCurrentPrompt()}>
					Copy prompt
				</Button>
			</div>
		</PaneContent>
	);
}
