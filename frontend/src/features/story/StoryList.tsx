// The Story section's navigation pane ('Stories'): every story with its cover (the illustration of its first
// illustrated scene, or a placeholder), its title and how far it is illustrated; the selected one is current
// (aria-current, the brand frame and background). New story is the section's primary action, in the toolbar; the empty
// list says how to start, the failed load offers Retry. Thin view over the story store.
import { Body1Strong, Button, Caption1, makeStyles, mergeClasses, Spinner, Subtitle2, tokens } from '@fluentui/react-components';
import { BookOpenRegular, BookAddRegular, ErrorCircleRegular } from '@fluentui/react-icons';
import { outputThumbnailUrl } from '../../api/config';
import type { Story } from '../../api/types';
import { storyCoverId, storyProgress, storyProgressText } from '../../domain/stories';
import { useOutputIdSet, useStoryStore } from '../../stores/storyStore';
import { EmptyState } from '../../ui/EmptyState';
import { STORY_LABELS } from './storyLabels';

const COVER_SIZE = '48px';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS}`,
		minWidth: 0,
	},
	heading: {
		display: 'flex',
		alignItems: 'baseline',
		justifyContent: 'space-between',
		gap: tokens.spacingHorizontalS,
		paddingLeft: tokens.spacingHorizontalS,
		paddingRight: tokens.spacingHorizontalS,
		margin: 0,
	},
	count: {
		color: tokens.colorNeutralForeground3,
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	item: {
		display: 'grid',
		gridTemplateColumns: `${COVER_SIZE} minmax(0, 1fr)`,
		alignItems: 'center',
		columnGap: tokens.spacingHorizontalS,
		width: '100%',
		maxWidth: 'none',
		minHeight: '64px',
		padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
		justifyContent: 'start',
		textAlign: 'start',
		fontWeight: tokens.fontWeightRegular,
		border: `${tokens.strokeWidthThin} solid transparent`,
	},
	current: {
		backgroundColor: tokens.colorBrandBackground2,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
		':hover': {
			backgroundColor: tokens.colorBrandBackground2Hover,
		},
	},
	cover: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: COVER_SIZE,
		height: COVER_SIZE,
		borderRadius: tokens.borderRadiusMedium,
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground3,
		color: tokens.colorNeutralForeground3,
		fontSize: tokens.fontSizeBase500,
	},
	coverImage: {
		display: 'block',
		width: '100%',
		height: '100%',
		objectFit: 'cover',
	},
	text: {
		display: 'flex',
		flexDirection: 'column',
		minWidth: 0,
	},
	title: {
		display: '-webkit-box',
		WebkitLineClamp: 2,
		WebkitBoxOrient: 'vertical',
		overflow: 'hidden',
		overflowWrap: 'anywhere',
		color: tokens.colorNeutralForeground1,
	},
	progress: {
		color: tokens.colorNeutralForeground3,
	},
	status: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalS,
		padding: tokens.spacingVerticalL,
		color: tokens.colorNeutralForeground2,
		textAlign: 'center',
	},
	errorIcon: {
		color: tokens.colorStatusDangerForeground1,
		fontSize: tokens.fontSizeBase500,
	},
});

function StoryItem({ story, current }: { story: Story; current: boolean }): JSX.Element {
	const styles = useStyles();
	const outputIds = useOutputIdSet();
	const selectStory = useStoryStore((state) => state.selectStory);
	const coverId = storyCoverId(story, outputIds);
	return (
		<li>
			<Button
				appearance="subtle"
				className={mergeClasses(styles.item, current && styles.current)}
				aria-current={current ? 'true' : undefined}
				onClick={() => selectStory(story.id)}
			>
				<span className={styles.cover} aria-hidden>
					{coverId ? <img className={styles.coverImage} src={outputThumbnailUrl(coverId)} alt="" loading="lazy" draggable={false} /> : <BookOpenRegular />}
				</span>
				<span className={styles.text}>
					<Body1Strong className={styles.title}>{story.title}</Body1Strong>
					<Caption1 className={styles.progress}>{storyProgressText(storyProgress(story, outputIds))}</Caption1>
				</span>
			</Button>
		</li>
	);
}

export function StoryList(): JSX.Element {
	const styles = useStyles();
	const stories = useStoryStore((state) => state.stories);
	const selectedId = useStoryStore((state) => state.selectedStoryId);
	const loadStatus = useStoryStore((state) => state.loadStatus);
	const loadError = useStoryStore((state) => state.loadError);
	const load = useStoryStore((state) => state.load);
	const createStory = useStoryStore((state) => state.createStory);

	let body: JSX.Element;
	if (stories.length === 0 && (loadStatus === 'loading' || loadStatus === 'idle')) {
		body = <Spinner size="small" label="Loading stories" className={styles.status} />;
	} else if (stories.length === 0 && loadStatus === 'failed') {
		body = (
			<div className={styles.status} role="alert">
				<ErrorCircleRegular className={styles.errorIcon} aria-hidden />
				<Caption1>The stories could not be loaded: {loadError}</Caption1>
				<Button size="small" onClick={() => void load()}>
					Retry
				</Button>
			</div>
		);
	} else if (stories.length === 0) {
		body = (
			<EmptyState
				icon={BookAddRegular}
				title="No story yet"
				titleAs="p"
				size="small"
				actions={
					<Button size="small" icon={<BookAddRegular />} onClick={() => void createStory()}>
						{STORY_LABELS.newStory}
					</Button>
				}
			>
				A story is a list of scenes, each with its text and its picture.
			</EmptyState>
		);
	} else {
		body = (
			<ul className={styles.list}>
				{stories.map((story) => (
					<StoryItem key={story.id} story={story} current={story.id === selectedId} />
				))}
			</ul>
		);
	}

	return (
		<div className={styles.root}>
			<h2 className={styles.heading}>
				<Subtitle2>{STORY_LABELS.storyList}</Subtitle2>
				{stories.length > 0 ? <Caption1 className={styles.count}>{stories.length}</Caption1> : null}
			</h2>
			{body}
		</div>
	);
}
