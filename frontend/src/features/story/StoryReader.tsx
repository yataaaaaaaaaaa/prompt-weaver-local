// Read mode of the selected story (the Story section's results region while the reader is open): a picture book, one
// scene per page, the picture on the left and the text on the right (stacked when narrow). The reader takes the focus
// when it opens and owns its keys (ownsKeysProps: the global shortcuts leave them alone): ArrowLeft / ArrowUp /
// PageUp the previous page, ArrowRight / ArrowDown / PageDown / Space the next one, Home / End the first / last
// (src/domain/stories.ts readerPageForKey), Escape closes it; Previous / Next buttons and the page position too. Thin
// view over the story store (its reader page) and the outputs store (which pictures exist).
import { Body2, Button, Caption1, makeStyles, mergeClasses, Title2, tokens } from '@fluentui/react-components';
import { ArrowLeftRegular, ArrowRightRegular, BookOpenRegular, DismissRegular, ImageOffRegular } from '@fluentui/react-icons';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { outputImageUrl } from '../../api/config';
import { readerPageForKey, sceneIllustrationId } from '../../domain/stories';
import { selectSelectedStory, useOutputIdSet, useStoryStore } from '../../stores/storyStore';
import { EmptyState } from '../../ui/EmptyState';
import { ownsKeysProps } from '../../ui/keyboard';
import { readerPageText, sceneIllustrationName, STORY_LABELS } from './storyLabels';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		height: '100%',
		minHeight: 0,
		outlineStyle: 'none',
	},
	page: {
		display: 'grid',
		gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)',
		gap: tokens.spacingHorizontalXXL,
		flex: 1,
		minHeight: 0,
		padding: tokens.spacingHorizontalXL,
		borderRadius: tokens.borderRadiusXLarge,
		backgroundColor: tokens.colorNeutralBackground1,
		boxShadow: tokens.shadow4,
		'@media (max-width: 960px)': {
			gridTemplateColumns: 'minmax(0, 1fr)',
			gridTemplateRows: 'minmax(240px, 1fr) auto',
		},
	},
	figure: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 0,
		margin: 0,
		borderRadius: tokens.borderRadiusLarge,
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground3,
	},
	picture: {
		display: 'block',
		maxWidth: '100%',
		maxHeight: '100%',
		objectFit: 'contain',
	},
	textColumn: {
		display: 'flex',
		flexDirection: 'column',
		justifyContent: 'center',
		gap: tokens.spacingVerticalM,
		minHeight: 0,
		overflowY: 'auto',
	},
	pageNumber: {
		color: tokens.colorNeutralForeground3,
		fontVariantNumeric: 'tabular-nums',
	},
	title: {
		margin: 0,
		overflowWrap: 'anywhere',
	},
	text: {
		margin: 0,
		whiteSpace: 'pre-wrap',
		overflowWrap: 'anywhere',
		fontSize: tokens.fontSizeBase400,
		lineHeight: tokens.lineHeightBase500,
		color: tokens.colorNeutralForeground1,
	},
	noText: {
		fontStyle: 'italic',
		color: tokens.colorNeutralForeground3,
	},
	controls: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: tokens.spacingHorizontalM,
		flexShrink: 0,
	},
	position: {
		minWidth: '96px',
		textAlign: 'center',
		color: tokens.colorNeutralForeground2,
		fontVariantNumeric: 'tabular-nums',
	},
});

export function StoryReader(): JSX.Element | null {
	const styles = useStyles();
	const rootRef = useRef<HTMLDivElement>(null);
	const story = useStoryStore(selectSelectedStory);
	const page = useStoryStore((state) => state.reader?.page ?? 0);
	const setReaderPage = useStoryStore((state) => state.setReaderPage);
	const closeReader = useStoryStore((state) => state.closeReader);
	const outputIds = useOutputIdSet();

	// The reader takes the focus when it opens, so its keys work at once.
	useEffect(() => {
		rootRef.current?.focus({ preventScroll: true });
	}, []);

	if (!story) {
		return null;
	}
	const total = story.scenes.length;
	const scene = story.scenes[page] ?? null;
	const illustration = scene ? sceneIllustrationId(scene, outputIds) : null;

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			closeReader();
			return;
		}
		// Space and Enter keep their meaning on the reader's own buttons.
		if (event.key === ' ' && event.target !== event.currentTarget) {
			return;
		}
		const target = readerPageForKey(event.key, page, total);
		if (target !== null) {
			event.preventDefault();
			setReaderPage(target);
		}
	};

	return (
		<div
			ref={rootRef}
			className={styles.root}
			tabIndex={-1}
			role="group"
			aria-roledescription="picture book"
			aria-label={`${story.title}, ${scene ? readerPageText(page, total) : 'no pages'}`}
			onKeyDown={onKeyDown}
			{...ownsKeysProps}
		>
			{scene === null ? (
				<EmptyState
					icon={BookOpenRegular}
					title="This story has no scenes yet"
					actions={
						<Button icon={<DismissRegular />} onClick={closeReader}>
							{STORY_LABELS.closeReader}
						</Button>
					}
				>
					Add scenes to the storyboard, then read them here.
				</EmptyState>
			) : (
				<>
					<article className={styles.page} aria-label={readerPageText(page, total)}>
						<figure className={styles.figure}>
							{illustration ? (
								<img className={styles.picture} src={outputImageUrl(illustration)} alt={sceneIllustrationName(scene.title)} />
							) : (
								<EmptyState icon={ImageOffRegular} title="No picture yet" titleAs="p" size="small">
									Generate this scene's picture in the storyboard.
								</EmptyState>
							)}
						</figure>
						<div className={styles.textColumn}>
							<Caption1 className={styles.pageNumber}>{readerPageText(page, total)}</Caption1>
							<Title2 as="h2" className={styles.title}>
								{scene.title}
							</Title2>
							<Body2 as="p" className={mergeClasses(styles.text, !scene.text.trim() && styles.noText)}>
								{scene.text.trim() ? scene.text : 'No text yet.'}
							</Body2>
						</div>
					</article>
					<div className={styles.controls}>
						<Button icon={<ArrowLeftRegular />} disabled={page <= 0} onClick={() => setReaderPage(page - 1)}>
							{STORY_LABELS.previousPage}
						</Button>
						<Caption1 className={styles.position} aria-live="polite">
							{readerPageText(page, total)}
						</Caption1>
						<Button icon={<ArrowRightRegular />} iconPosition="after" disabled={page >= total - 1} onClick={() => setReaderPage(page + 1)}>
							{STORY_LABELS.nextPage}
						</Button>
						<Button appearance="subtle" icon={<DismissRegular />} onClick={closeReader}>
							{STORY_LABELS.closeReader}
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
