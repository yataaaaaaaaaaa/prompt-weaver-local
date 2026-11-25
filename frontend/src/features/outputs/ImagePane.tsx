// Shows the output being viewed (outputs store), scaled to fit the pane (never distorted, centered). Without outputs,
// without a current output, or when the image file cannot be loaded (moved or deleted outside the app), a Fluent empty
// state says so instead of a broken image. Whether the browser could load the picture is ephemeral view state (the
// URL that failed), kept locally.
import { Body1, Caption1, Image, makeStyles, tokens } from '@fluentui/react-components';
import { ImageOffRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { selectCurrentImageUrl, useOutputsStore } from '../../stores/outputsStore';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		height: '100%',
		boxSizing: 'border-box',
		padding: tokens.spacingHorizontalS,
		minHeight: 0,
	},
	image: {
		minWidth: 0,
		minHeight: 0,
	},
	empty: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalS,
		maxWidth: '100%',
		padding: tokens.spacingHorizontalL,
		boxSizing: 'border-box',
		textAlign: 'center',
		color: tokens.colorNeutralForeground3,
	},
	emptyIcon: {
		fontSize: tokens.fontSizeHero800,
	},
	emptyTitle: {
		color: tokens.colorNeutralForeground2,
	},
});

function EmptyState({ title, detail }: { title: string; detail: string }): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.empty} role="status">
			<ImageOffRegular aria-hidden className={styles.emptyIcon} />
			<Body1 className={styles.emptyTitle}>{title}</Body1>
			<Caption1>{detail}</Caption1>
		</div>
	);
}

export function ImagePane(): JSX.Element {
	const styles = useStyles();
	const imageUrl = useOutputsStore(selectCurrentImageUrl);
	const currentId = useOutputsStore((state) => state.currentId);
	const hasOutputs = useOutputsStore((state) => state.ids.length > 0);
	const [failedUrl, setFailedUrl] = useState<string | null>(null);

	let content: JSX.Element;
	if (!imageUrl) {
		content = hasOutputs ? (
			<EmptyState title="No image selected." detail="Pick an output in the Output browser." />
		) : (
			<EmptyState title="No outputs yet." detail="Generated images appear here." />
		);
	} else if (failedUrl === imageUrl) {
		content = (
			<EmptyState
				title={`The image of output #${currentId} could not be loaded.`}
				detail="Its file may have been moved or deleted outside the app."
			/>
		);
	} else {
		content = (
			<Image
				key={imageUrl}
				className={styles.image}
				src={imageUrl}
				alt={`Output ${currentId}`}
				fit="contain"
				onError={() => setFailedUrl(imageUrl)}
			/>
		);
	}
	return <div className={styles.root}>{content}</div>;
}
