// The 'Output details' list of the viewer's Details tab: number and position, image name, size, steps, CFG, seed, prompt
// seed, model, the LoRAs with their weights (one per line; a long name is truncated with its full text in a tooltip, the
// weight always stays visible), the story scene, the character, then the prompt and negative prompt. Thin view over the
// outputs store (useCurrentOutputDetails, selectNavigation).
import { makeStyles, Spinner, tokens, Tooltip } from '@fluentui/react-components';
import { DocumentTextRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { weightedLoraParts, weightedLoraText } from '../../domain/loraSelection';
import { outputCharacterText, outputStoryText } from '../../domain/outputs';
import { selectNavigation, useCurrentOutputDetails, useOutputsStore } from '../../stores/outputsStore';
import { EmptyState } from '../../ui/EmptyState';
import { FactList } from '../../ui/FactList';
import { VIEWER_LABELS } from './viewerLabels';

const useStyles = makeStyles({
	list: {
		margin: 0,
		padding: 0,
		listStyleType: 'none',
		minWidth: 0,
	},
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
});

/** '4 / 12' (position of the current output), '— / 12' without one. */
export function positionText(index: number, count: number): string {
	return `${index >= 0 ? index + 1 : '—'} / ${count}`;
}

export function OutputDetailsList(): JSX.Element {
	const styles = useStyles();
	const details = useCurrentOutputDetails();
	const navigation = useOutputsStore(useShallow(selectNavigation));
	const loadingRecord = useOutputsStore((state) => state.loadingRecord);

	if (!details) {
		return loadingRecord ? (
			<Spinner size="tiny" label="Loading output details…" />
		) : (
			<EmptyState icon={DocumentTextRegular} title={navigation.count === 0 ? 'No details yet' : 'No details'} titleAs="p" size="small" live>
				{navigation.count === 0 ? 'Generate an image to see how it was made here.' : 'Pick an output in the filmstrip to see how it was made.'}
			</EmptyState>
		);
	}

	const rows: Array<[string, ReactNode]> = [
		['Output', `#${details.outputId}`],
		['Position', positionText(navigation.index, navigation.count)],
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
	if (details.story) {
		rows.push(['Story', outputStoryText(details.story)]);
	}
	if (details.character) {
		rows.push(['Character', outputCharacterText(details.character)]);
	}
	rows.push(['Prompt', details.prompt || '—']);
	rows.push(['Negative prompt', details.negativePrompt || '—']);
	return <FactList label={VIEWER_LABELS.detailsList} facts={rows.map(([term, value]) => ({ term, value }))} />;
}
