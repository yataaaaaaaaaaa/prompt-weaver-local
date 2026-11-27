// The co-writer's message box: Enter sends (Ctrl+Enter too), Shift+Enter starts a new line; while Codex answers, Send
// becomes Stop (amber: it stops the answer and what it started, e.g. a scene generation) and the next message can
// already be typed. The draft lives in the co-writer store (it survives a collapsed dock or another story).
import { Button, makeStyles, Spinner, Textarea, tokens, typographyStyles } from '@fluentui/react-components';
import { SendRegular, StopRegular } from '@fluentui/react-icons';
import { useMemo, type KeyboardEvent } from 'react';
import { conversationKey } from '../../domain/coWriter';
import { selectConversation, useCodexStore } from '../../stores/codexStore';
import { useActionClasses } from '../../ui/stateStyles';
import { CO_WRITER_LABELS } from './coWriterLabels';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM} ${tokens.spacingVerticalM}`,
		borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
	},
	input: {
		width: '100%',
		'& textarea': {
			maxHeight: '160px',
		},
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: tokens.spacingHorizontalS,
		minHeight: '32px',
	},
	hint: {
		...typographyStyles.caption1,
		color: tokens.colorNeutralForeground3,
	},
});

export function CoWriterComposer({ storyId }: { storyId: string | null }): JSX.Element {
	const styles = useStyles();
	const actions = useActionClasses();
	const key = conversationKey(storyId);
	const draft = useCodexStore((state) => state.drafts[key] ?? '');
	const sending = useCodexStore((state) => state.sending[key] === true);
	const running = useCodexStore(useMemo(() => selectConversation(storyId), [storyId]))?.running ?? false;
	const setDraft = useCodexStore((state) => state.setDraft);
	const send = useCodexStore((state) => state.send);
	const stop = useCodexStore((state) => state.stop);
	const canSend = draft.trim() !== '' && !sending && !running;

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.nativeEvent.isComposing) {
			return;
		}
		event.preventDefault();
		if (canSend) {
			void send(storyId, draft);
		}
	};

	return (
		<div className={styles.root}>
			<Textarea
				className={styles.input}
				aria-label={CO_WRITER_LABELS.message}
				placeholder="Ask Codex to write, revise or illustrate the story…"
				value={draft}
				resize="none"
				rows={3}
				onChange={(_event, data) => setDraft(storyId, data.value)}
				onKeyDown={onKeyDown}
			/>
			<div className={styles.actions}>
				{running ? (
					<Spinner size="extra-tiny" label={CO_WRITER_LABELS.working} labelPosition="after" />
				) : (
					<span className={styles.hint}>Enter sends · Shift+Enter: new line</span>
				)}
				{running ? (
					<Button className={actions.filled.warning} icon={<StopRegular />} onClick={() => void stop(storyId)}>
						{CO_WRITER_LABELS.stop}
					</Button>
				) : (
					<Button appearance="primary" icon={<SendRegular />} disabled={!canSend} onClick={() => void send(storyId, draft)}>
						{CO_WRITER_LABELS.send}
					</Button>
				)}
			</div>
		</div>
	);
}
