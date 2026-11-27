// The co-writer's conversation (a log): the user's messages, Codex's answers (streamed), its tool activity ('Added
// Scene 3 · The storm', 'Generating Scene 3 · The storm…', with a link that shows the scene), errors and notices. It
// keeps the newest entry in view while the user has not scrolled up. Screen readers hear each finished answer and tool
// activity once (a polite live region), not every streamed word. Thin view over the co-writer and story stores.
import { Link, makeStyles, MessageBar, MessageBarBody, mergeClasses, Spinner, tokens, typographyStyles } from '@fluentui/react-components';
import { CheckmarkCircleRegular, DismissCircleRegular, SparkleRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useRef } from 'react';
import type { CodexEntry, Story } from '../../api/types';
import { sceneLabel, toolActivityText } from '../../domain/coWriter';
import { selectConversation, useCodexStore } from '../../stores/codexStore';
import { useStoryStore } from '../../stores/storyStore';
import { EmptyState } from '../../ui/EmptyState';
import { useVisuallyHiddenClass } from '../../ui/visuallyHidden';
import { CO_WRITER_LABELS, showTargetLabel } from './coWriterLabels';

/** How close to the bottom (px) still counts as "following" the conversation. */
const FOLLOW_DISTANCE_PX = 48;

const useStyles = makeStyles({
	log: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		flex: 1,
		minHeight: 0,
		overflowY: 'auto',
		padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
		':focus-visible': {
			outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
			outlineOffset: `calc(-1 * ${tokens.strokeWidthThick})`,
		},
	},
	message: {
		...typographyStyles.body1,
		maxWidth: '92%',
		padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
		borderRadius: tokens.borderRadiusLarge,
		whiteSpace: 'pre-wrap',
		overflowWrap: 'anywhere',
		margin: 0,
	},
	user: {
		alignSelf: 'flex-end',
		backgroundColor: tokens.colorBrandBackground2,
		color: tokens.colorNeutralForeground1,
	},
	assistant: {
		alignSelf: 'flex-start',
		backgroundColor: tokens.colorNeutralBackground3,
		color: tokens.colorNeutralForeground1,
	},
	tool: {
		display: 'flex',
		alignItems: 'flex-start',
		gap: tokens.spacingHorizontalS,
		...typographyStyles.caption1,
		color: tokens.colorNeutralForeground2,
		padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
		overflowWrap: 'anywhere',
	},
	toolIcon: {
		display: 'flex',
		flexShrink: 0,
		fontSize: tokens.fontSizeBase400,
		color: tokens.colorNeutralForeground3,
		paddingTop: '1px',
	},
	toolText: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'baseline',
		columnGap: tokens.spacingHorizontalS,
		minWidth: 0,
	},
	failed: {
		color: tokens.colorNeutralForeground1,
	},
	show: {
		...typographyStyles.caption1,
	},
	notice: {
		...typographyStyles.caption1,
		alignSelf: 'center',
		color: tokens.colorNeutralForeground3,
		margin: 0,
	},
	empty: {
		margin: 'auto 0',
	},
});

function ToolRow({ entry, stories }: { entry: CodexEntry; stories: readonly Story[] }): JSX.Element {
	const styles = useStyles();
	const selectStory = useStoryStore((state) => state.selectStory);
	const selectScene = useStoryStore((state) => state.selectScene);
	const closeReader = useStoryStore((state) => state.closeReader);
	const story = entry.story_id ? stories.find((item) => item.id === entry.story_id) : undefined;
	const sceneName = story && entry.scene_id ? sceneLabel(story, entry.scene_id) : null;
	const target = sceneName ?? (story && !entry.scene_id ? story.title : null);
	const show = () => {
		if (!story) {
			return;
		}
		closeReader();
		selectStory(story.id);
		selectScene(entry.scene_id && sceneName ? entry.scene_id : null);
	};
	const failed = entry.status === 'failed';
	return (
		<div className={styles.tool} data-entry-kind="tool" data-entry-status={entry.status}>
			<span className={styles.toolIcon} aria-hidden>
				{entry.status === 'running' ? <Spinner size="extra-tiny" /> : failed ? <DismissCircleRegular /> : <CheckmarkCircleRegular />}
			</span>
			<span className={styles.toolText}>
				<span className={mergeClasses(failed && styles.failed)}>{toolActivityText(entry, stories)}</span>
				{target ? (
					<Link as="button" inline className={styles.show} onClick={show} aria-label={showTargetLabel(target)}>
						Show
					</Link>
				) : null}
			</span>
		</div>
	);
}

function Entry({ entry, stories }: { entry: CodexEntry; stories: readonly Story[] }): JSX.Element {
	const styles = useStyles();
	switch (entry.kind) {
		case 'user':
			return (
				<p className={mergeClasses(styles.message, styles.user)} data-entry-kind="user">
					{entry.text}
				</p>
			);
		case 'assistant':
			return (
				<p className={mergeClasses(styles.message, styles.assistant)} data-entry-kind="assistant" data-entry-status={entry.status} aria-busy={entry.status === 'running'}>
					{entry.text}
				</p>
			);
		case 'tool':
			return <ToolRow entry={entry} stories={stories} />;
		case 'error':
			return (
				<MessageBar intent="error" layout="multiline" data-entry-kind="error">
					<MessageBarBody>{entry.text}</MessageBarBody>
				</MessageBar>
			);
		case 'notice':
			return (
				<p className={styles.notice} data-entry-kind="notice">
					{entry.text}
				</p>
			);
	}
}

/** The last finished answer or tool activity, for the live region. */
function announcementOf(entries: readonly CodexEntry[], stories: readonly Story[]): string {
	const last = [...entries].reverse().find((entry) => entry.kind !== 'user' && entry.status !== 'running');
	if (!last) {
		return '';
	}
	return last.kind === 'tool' ? toolActivityText(last, stories) : last.kind === 'assistant' ? `Codex: ${last.text}` : last.text;
}

export function CoWriterTranscript({ storyId }: { storyId: string | null }): JSX.Element {
	const styles = useStyles();
	const hidden = useVisuallyHiddenClass();
	const conversation = useCodexStore(useMemo(() => selectConversation(storyId), [storyId]));
	const loading = useCodexStore((state) => state.loading[storyId ?? ''] === true);
	const stories = useStoryStore((state) => state.stories);
	const entries = conversation?.entries ?? [];
	const running = conversation?.running ?? false;
	const logRef = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const lastEntry = entries[entries.length - 1];

	useEffect(() => {
		const log = logRef.current;
		if (log && (following.current || lastEntry?.kind === 'user')) {
			log.scrollTop = log.scrollHeight;
			following.current = true;
		}
	}, [entries, running, lastEntry]);

	return (
		<>
			<div
				ref={logRef}
				role="log"
				aria-label={CO_WRITER_LABELS.transcript}
				aria-live="off"
				tabIndex={0}
				className={styles.log}
				onScroll={(event) => {
					const log = event.currentTarget;
					following.current = log.scrollHeight - log.scrollTop - log.clientHeight < FOLLOW_DISTANCE_PX;
				}}
			>
				{entries.length === 0 ? (
					loading ? (
						<Spinner size="small" label="Loading the conversation…" className={styles.empty} />
					) : (
						<EmptyState icon={SparkleRegular} title="Write with Codex" titleAs="p" size="small" className={styles.empty}>
							Ask Codex to plan the story, write or revise scenes and their tags, or illustrate them. It works on the story you are viewing.
						</EmptyState>
					)
				) : (
					entries.map((entry) => <Entry key={entry.id} entry={entry} stories={stories} />)
				)}
			</div>
			<div className={hidden} aria-live="polite" role="status">
				{announcementOf(entries, stories)}
			</div>
		</>
	);
}
