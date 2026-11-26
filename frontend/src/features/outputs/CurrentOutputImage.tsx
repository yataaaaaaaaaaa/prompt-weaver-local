// The picture of the output being viewed (outputs store), fitted into the space left by the toolbar, the filmstrip and
// the details panel: never distorted (object-fit contain), centered. It is the only picture named 'Output <id>' (the
// filmstrip thumbnails have an empty alt inside named options). Without outputs, without a current output, or when the
// picture cannot be loaded (moved or deleted outside the app), a Fluent empty state says so and what to do instead of a
// broken image. Whether the browser could load the picture is ephemeral view state (the URL that failed), kept locally.
import { Image, makeStyles, tokens } from '@fluentui/react-components';
import { ImageMultipleRegular, ImageOffRegular, SparkleRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { selectCurrentImageUrl, useOutputsStore } from '../../stores/outputsStore';
import { EmptyState } from '../../ui/EmptyState';
import { withShortcut } from '../../ui/keyboard';
import { outputPictureName } from './viewerLabels';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		flex: '1 1 0',
		minHeight: 0,
		minWidth: 0,
		boxSizing: 'border-box',
		padding: tokens.spacingHorizontalS,
		// The canvas of the picture: a step darker than the toolbar and the panels around it.
		backgroundColor: tokens.colorNeutralBackground3,
		overflow: 'hidden',
	},
	image: {
		minWidth: 0,
		minHeight: 0,
	},
});

/** The texts of the viewer's empty states (one place: the view and its tests). */
export const VIEWER_EMPTY_TEXTS = {
	noOutputs: {
		title: 'No outputs yet',
		detail: `${withShortcut('Press Generate', 'generate')} in the Generation panel to make the first image: it appears here and in the filmstrip below.`,
	},
	noSelection: { title: 'No output selected', detail: 'Pick an output in the filmstrip below.' },
	missingPicture: (outputId: string | null) => ({
		title: `The image of output #${outputId ?? ''} could not be loaded.`,
		detail: 'Its file may have been moved or deleted outside the app.',
	}),
} as const;

export function CurrentOutputImage(): JSX.Element {
	const styles = useStyles();
	const imageUrl = useOutputsStore(selectCurrentImageUrl);
	const currentId = useOutputsStore((state) => state.currentId);
	const hasOutputs = useOutputsStore((state) => state.ids.length > 0);
	const [failedUrl, setFailedUrl] = useState<string | null>(null);

	let content: JSX.Element;
	if (!imageUrl) {
		const texts = hasOutputs ? VIEWER_EMPTY_TEXTS.noSelection : VIEWER_EMPTY_TEXTS.noOutputs;
		content = (
			<EmptyState icon={hasOutputs ? ImageMultipleRegular : SparkleRegular} emphasis={!hasOutputs} title={texts.title} titleAs="p" live>
				{texts.detail}
			</EmptyState>
		);
	} else if (failedUrl === imageUrl) {
		const texts = VIEWER_EMPTY_TEXTS.missingPicture(currentId);
		content = (
			<EmptyState icon={ImageOffRegular} title={texts.title} titleAs="p" live>
				{texts.detail}
			</EmptyState>
		);
	} else {
		content = (
			<Image
				key={imageUrl}
				className={styles.image}
				src={imageUrl}
				alt={currentId === null ? '' : outputPictureName(currentId)}
				fit="contain"
				onError={() => setFailedUrl(imageUrl)}
			/>
		);
	}
	return <div className={styles.root}>{content}</div>;
}
