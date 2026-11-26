// Card frame shared by the online result cards and the local library entries: preview image (or a centered
// placeholder icon), name heading, description, badges row and the entry's own content. Pure layout view.
// With `onOpen` the name is a link button that opens the entry in the detail panel (marked as its opener, see
// DetailPanel.tsx; a click on the preview opens it too), and `selected` marks the entry shown there.
import {
	Body1Strong,
	Caption1,
	Card,
	CardHeader,
	CardPreview,
	Image,
	Link,
	makeStyles,
	mergeClasses,
	shorthands,
	tokens,
	useId,
} from '@fluentui/react-components';
import { ImageOffRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { detailOpenerProps } from '../../ui/DetailPanel';

const useStyles = makeStyles({
	card: {
		minWidth: 0,
		height: '100%',
	},
	// The entry shown in the detail panel: a brand border (drawn by the card's own border layer) on the selected
	// background.
	selected: {
		backgroundColor: tokens.colorNeutralBackground1Selected,
		'::after': {
			...shorthands.borderColor(tokens.colorBrandStroke1),
			...shorthands.borderWidth(tokens.strokeWidthThick),
		},
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
	clickable: {
		cursor: 'pointer',
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
		alignSelf: 'stretch',
		flex: '1 1 auto',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	name: {
		overflowWrap: 'anywhere',
	},
	nameLink: {
		textAlign: 'start',
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
	/** Opens the entry in the detail panel (the name becomes a link button). */
	onOpen?: () => void;
	/** Key of the entry in the detail panel (the name is its opener); required with onOpen. */
	openerKey?: string;
	/** The entry is the one shown in the detail panel. */
	selected?: boolean;
};

export function ModelEntryCard({ name, description, previewUrl, badges, children, onOpen, openerKey, selected = false }: ModelEntryCardProps): JSX.Element {
	const styles = useStyles();
	const nameId = useId('model-entry-name-');
	const nameText = (
		<Body1Strong id={nameId} className={styles.name}>
			{name}
		</Body1Strong>
	);
	return (
		<Card orientation="horizontal" className={mergeClasses(styles.card, selected && styles.selected)} aria-labelledby={nameId}>
			{/* The preview repeats the name link for the pointer only (the link is the keyboard way). */}
			<CardPreview className={mergeClasses(styles.preview, onOpen && styles.clickable)} onClick={onOpen}>
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
						onOpen ? (
							<Link
								as="button"
								appearance="subtle"
								className={styles.nameLink}
								aria-current={selected ? 'true' : undefined}
								onClick={onOpen}
								{...(openerKey !== undefined ? detailOpenerProps(openerKey) : {})}
							>
								{nameText}
							</Link>
						) : (
							nameText
						)
					}
					description={description ? <Caption1 className={styles.description}>{description}</Caption1> : undefined}
				/>
				{badges ? <div className={styles.badges}>{badges}</div> : null}
				{children}
			</div>
		</Card>
	);
}
