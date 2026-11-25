// Card frame shared by the online result cards and the local library entries: preview image (or a centered
// placeholder icon), name heading, description, badges row and the entry's own content. Pure layout view.
import { Body1Strong, Caption1, Card, CardHeader, CardPreview, Image, makeStyles, tokens, useId } from '@fluentui/react-components';
import { ImageOffRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
	card: {
		minWidth: 0,
	},
	// The horizontal Card centers its children: the preview stretches to the card height (any content height) and
	// its picture covers it, bleeding to the card's left edges (rounded like the card).
	preview: {
		position: 'relative',
		display: 'flex',
		alignSelf: 'stretch',
		flexShrink: 0,
		width: '112px',
		minHeight: '112px',
		overflow: 'hidden',
		borderTopLeftRadius: tokens.borderRadiusMedium,
		borderBottomLeftRadius: tokens.borderRadiusMedium,
		backgroundColor: tokens.colorNeutralBackground3,
	},
	picture: {
		position: 'absolute',
		top: 0,
		left: 0,
		width: '100%',
		height: '100%',
	},
	// CardPreview makes its direct children blocks: the placeholder covers the preview and its inner box centers the
	// icon.
	placeholder: {
		position: 'absolute',
		top: 0,
		left: 0,
		width: '100%',
		height: '100%',
	},
	placeholderIcon: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		height: '100%',
		color: tokens.colorNeutralForeground3,
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
	/** Secondary line under the name (creator and downloads, file path...); inline content. */
	description?: ReactNode;
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
					<Image className={styles.picture} src={previewUrl} alt={name} fit="cover" loading="lazy" />
				) : (
					<div className={styles.placeholder}>
						<span className={styles.placeholderIcon}>
							<ImageOffRegular aria-hidden />
						</span>
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
