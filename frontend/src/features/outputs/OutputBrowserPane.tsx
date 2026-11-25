// Output browser: first/previous/next/last/delete, generation progress and the metadata of the output
// being viewed (with its character, one line per LoRA), Copy prompt and Create character (prefilled from the output).
// Thin view over the outputs store and the characters store. Delete is the danger action (src/ui/stateColors.ts).
import { Body1, Button, Caption1, makeStyles, mergeClasses, Spinner, tokens, Tooltip } from '@fluentui/react-components';
import {
	ArrowNextRegular,
	ArrowPreviousRegular,
	ChevronLeftRegular,
	ChevronRightRegular,
	CopyRegular,
	DeleteRegular,
	PersonAddRegular,
} from '@fluentui/react-icons';
import type { ReactElement, ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AppCommand } from '../../app/commands';
import { weightedLoraParts, weightedLoraText } from '../../domain/loraSelection';
import { outputCharacterText } from '../../domain/outputs';
import { useCharactersStore } from '../../stores/charactersStore';
import { selectNavigation, useCurrentOutputDetails, useOutputsStore, type CurrentOutputDetails } from '../../stores/outputsStore';
import { ariaKeyShortcuts, withShortcut } from '../../ui/keyboard';
import { PaneContent } from '../../ui/PaneLayout';
import { useActionClasses } from '../../ui/stateStyles';
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
	list: {
		margin: 0,
		padding: 0,
		listStyleType: 'none',
		minWidth: 0,
	},
	// One LoRA per line: a long name is truncated (full text in the tooltip), its weight always stays visible.
	lora: {
		display: 'flex',
		columnGap: tokens.spacingHorizontalXS,
		minWidth: 0,
	},
	loraName: {
		minWidth: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	loraWeight: {
		flexShrink: 0,
		whiteSpace: 'nowrap',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
	actions: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
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
	const rows: Array<[string, ReactNode]> = [
		['Output', `#${details.outputId}`],
		['Position', position],
		['Image name', details.imageName],
		['Size', `${details.width} × ${details.height}`],
		['Steps', String(details.steps)],
		['CFG', String(details.guidanceScale)],
		['Seed', String(details.seed)],
		['Prompt seed', details.promptSeed === null ? '—' : String(details.promptSeed)],
		['Model', details.modelName || '—'],
		[
			'LoRAs',
			details.loras.length > 0 ? (
				<ul className={styles.list}>
					{details.loras.map((lora, index) => {
						const parts = weightedLoraParts(lora);
						return (
							<li key={`${index}:${lora.name}`} className={styles.lora}>
								<Tooltip content={weightedLoraText(lora)} relationship="inaccessible">
									<span className={styles.loraName}>{parts.name}</span>
								</Tooltip>{' '}
								<span className={styles.loraWeight}>{parts.weight}</span>
							</li>
						);
					})}
				</ul>
			) : (
				'None'
			),
		],
	];
	if (details.character) {
		rows.push(['Character', outputCharacterText(details.character)]);
	}
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
	const actions = useActionClasses();
	const navigation = useOutputsStore(useShallow(selectNavigation));
	const loadingRecord = useOutputsStore((state) => state.loadingRecord);
	const first = useOutputsStore((state) => state.first);
	const previous = useOutputsStore((state) => state.previous);
	const next = useOutputsStore((state) => state.next);
	const last = useOutputsStore((state) => state.last);
	const deleteCurrent = useOutputsStore((state) => state.deleteCurrent);
	const copyCurrentPrompt = useOutputsStore((state) => state.copyCurrentPrompt);
	const startCreateFromOutput = useCharactersStore((state) => state.startCreateFromOutput);
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
						appearance="primary"
						className={mergeClasses(styles.delete, actions.filled.danger)}
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
				<Body1 className={styles.muted}>{navigation.count === 0 ? 'No outputs yet: generate an image to see its details here.' : 'No output selected.'}</Body1>
			)}
			<div className={styles.actions}>
				<Button icon={<CopyRegular />} disabled={!details?.prompt} onClick={() => void copyCurrentPrompt()}>
					Copy prompt
				</Button>
				<Tooltip content="New character prefilled with this output's tags, LoRAs and seed; its image becomes the reference" relationship="description">
					<Button icon={<PersonAddRegular />} disabled={!details} onClick={() => startCreateFromOutput()}>
						Create character
					</Button>
				</Tooltip>
			</div>
		</PaneContent>
	);
}
