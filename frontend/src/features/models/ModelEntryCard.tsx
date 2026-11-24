// Card frame shared by the online result cards and the local library entries: preview image (or a
// placeholder), name heading, description, badges row and the entry's own content. Pure layout view.
import { Body1Strong, Caption1, Card, CardHeader, CardPreview, Image, makeStyles, tokens, useId } from '@fluentui/react-components';
import { ImageOffRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
	card: {
		minWidth: 0,
	},
	preview: {
		flexShrink: 0,
		width: '112px',
		minHeight: '112px',
		backgroundColor: tokens.colorNeutralBackground3,
	},
	placeholder: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		height: '100%',
		color: tokens.colorNeutralForeground4,
		fontSize: tokens.fontSizeHero700,
	},
	body: {
		display: 'flex',
		flexDirection: 'column',
		flex: '1 1 auto',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	name: {
		overflowWrap: 'anywhere',
	},
	description: {
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
	},
	badges: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXS,
	},
});

export type ModelEntryCardProps = {
	name: string;
	/** Secondary line under the name (creator, path...). */
	description?: string | null;
	previewUrl: string | null;
	badges?: ReactNode;
	children?: ReactNode;
};

export function ModelEntryCard({ name, description, previewUrl, badges, children }: ModelEntryCardProps): JSX.Element {
	const styles = useStyles();
	const nameId = useId('model-entry-name-');
	return (
		<Card orientation="horizontal" className={styles.card} aria-labelledby={nameId}>
			<CardPreview className={styles.preview}>
				{previewUrl ? (
					<Image src={previewUrl} alt={name} fit="cover" loading="lazy" />
				) : (
					<div className={styles.placeholder}>
						<ImageOffRegular aria-hidden />
					</div>
				)}
			</CardPreview>
			<div className={styles.body}>
				<CardHeader
					header={
						<Body1Strong id={nameId} className={styles.name}>
							{name}
						</Body1Strong>
					}
					description={description ? <Caption1 className={styles.description}>{description}</Caption1> : undefined}
				/>
				{badges ? <div className={styles.badges}>{badges}</div> : null}
				{children}
			</div>
		</Card>
	);
}
