// Trigger words of a model version / library entry as chips, with a copy button (modelCatalogStore.copyTriggerWords).
// Renders nothing without words.
import { Badge, Button, Caption1, makeStyles, tokens, Tooltip } from '@fluentui/react-components';
import { CopyRegular } from '@fluentui/react-icons';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXS,
		minWidth: 0,
	},
	label: {
		color: tokens.colorNeutralForeground3,
	},
	list: {
		display: 'contents',
	},
	word: {
		maxWidth: '100%',
		overflowWrap: 'anywhere',
	},
});

export const COPY_TRIGGER_WORDS_LABEL = 'Copy trigger words';

export function TriggerWords({ words }: { words: readonly string[] }): JSX.Element | null {
	const styles = useStyles();
	const copyTriggerWords = useModelCatalogStore((state) => state.copyTriggerWords);
	if (words.length === 0) {
		return null;
	}
	return (
		<div className={styles.root}>
			<Caption1 className={styles.label}>Trigger words</Caption1>
			<div role="list" aria-label="Trigger words" className={styles.list}>
				{words.map((word, index) => (
					<Badge key={`${index}-${word}`} role="listitem" appearance="outline" shape="rounded" color="informative" className={styles.word}>
						{word}
					</Badge>
				))}
			</div>
			<Tooltip content={COPY_TRIGGER_WORDS_LABEL} relationship="label">
				<Button
					appearance="subtle"
					size="small"
					icon={<CopyRegular />}
					aria-label={COPY_TRIGGER_WORDS_LABEL}
					onClick={() => void copyTriggerWords(words)}
				/>
			</Tooltip>
		</div>
	);
}
