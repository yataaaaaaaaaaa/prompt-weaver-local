// The co-writer panel, plugged into the Story section's dock (src/features/story/storyDock.ts): the user's own Codex
// (their installed OpenAI Codex and its login) as a co-writer of the story shown. Top to bottom: the header (its name,
// the Codex version and model, the commands: Model, New conversation, Collapse), then either the setup state (looking
// for Codex, not found with a path field, not signed in, cannot start: each with Retry) or the conversation of the
// selected story (the draft conversation while no story is selected) and the message box.
//
// Codex acts on the stories through the app's tools; this window runs the tool calls of the messages it sent, through
// the story store's actions (src/stores/coWriterTools.ts), so the storyboard shows each change. Thin view over the
// co-writer store (src/stores/codexStore.ts) and the story store; the panel reads the status when it is first shown and
// the conversation of each story it shows.
import {
	Caption1,
	makeStyles,
	Menu,
	MenuItemRadio,
	MenuList,
	MenuPopover,
	MenuTrigger,
	Subtitle2,
	Toolbar,
	ToolbarButton,
	Tooltip,
	tokens,
} from '@fluentui/react-components';
import { BotSparkleRegular, ComposeRegular, PanelRightContractRegular, SparkleRegular } from '@fluentui/react-icons';
import { useEffect, useMemo } from 'react';
import { selectConversation, useCodexStore } from '../../stores/codexStore';
import { useStoryStore } from '../../stores/storyStore';
import { CO_WRITER_LABELS, CO_WRITER_STATE_ATTRIBUTE, defaultModelLabel } from './coWriterLabels';
import { CoWriterComposer } from './CoWriterComposer';
import { CoWriterSetup } from './CoWriterSetup';
import { CoWriterTranscript } from './CoWriterTranscript';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		flex: 1,
		minHeight: 0,
		minWidth: 0,
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
		padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		minWidth: 0,
	},
	icon: {
		display: 'flex',
		flexShrink: 0,
		fontSize: tokens.fontSizeBase500,
		color: tokens.colorBrandForeground1,
	},
	titles: {
		display: 'flex',
		flexDirection: 'column',
		flex: 1,
		minWidth: 0,
	},
	title: {
		margin: 0,
	},
	subtitle: {
		color: tokens.colorNeutralForeground3,
		whiteSpace: 'nowrap',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
	},
	toolbar: {
		flexShrink: 0,
		padding: 0,
	},
});

/** What the panel shows (the state attribute of its root). */
function panelState(statusLoad: string, state: string | undefined): string {
	if (statusLoad === 'loading' || (statusLoad === 'idle' && state === undefined)) {
		return 'checking';
	}
	return statusLoad === 'failed' || state === undefined ? 'unreachable' : state;
}

function ModelMenu(): JSX.Element {
	const status = useCodexStore((state) => state.status);
	const setModel = useCodexStore((state) => state.setModel);
	const current = status?.model ?? '';
	const models = (status?.models ?? []).filter((model) => model.id !== status?.default_model);
	const shown = status?.model ?? status?.default_model ?? null;
	return (
		<Menu
			checkedValues={{ model: [current] }}
			onCheckedValueChange={(_event, data) => void setModel(data.checkedItems[0] || null)}
			positioning="below-end"
		>
			<MenuTrigger disableButtonEnhancement>
				<Tooltip content={`${CO_WRITER_LABELS.model}: ${shown ?? 'default'}`} relationship="label">
					<ToolbarButton appearance="subtle" icon={<BotSparkleRegular />} />
				</Tooltip>
			</MenuTrigger>
			<MenuPopover>
				<MenuList>
					<MenuItemRadio name="model" value="">
						{defaultModelLabel(status?.default_model ?? null)}
					</MenuItemRadio>
					{models.map((model) => (
						<MenuItemRadio key={model.id} name="model" value={model.id}>
							{model.name}
						</MenuItemRadio>
					))}
				</MenuList>
			</MenuPopover>
		</Menu>
	);
}

function PanelHeader({ storyId, ready }: { storyId: string | null; ready: boolean }): JSX.Element {
	const styles = useStyles();
	const status = useCodexStore((state) => state.status);
	const conversation = useCodexStore(useMemo(() => selectConversation(storyId), [storyId]));
	const newConversation = useCodexStore((state) => state.newConversation);
	const setDockCollapsed = useStoryStore((state) => state.setDockCollapsed);
	const model = status?.model ?? status?.default_model ?? null;
	const subtitle = ready ? [status?.version ? `Codex ${status.version}` : 'Codex', model].filter(Boolean).join(' · ') : 'Your OpenAI Codex';
	const canRestart = ready && conversation !== null && conversation.entries.length > 0 && !conversation.running;
	return (
		<div className={styles.header}>
			<span className={styles.icon} aria-hidden>
				<SparkleRegular />
			</span>
			<div className={styles.titles}>
				<Subtitle2 as="h2" className={styles.title}>
					{CO_WRITER_LABELS.panel}
				</Subtitle2>
				<Caption1 className={styles.subtitle}>{subtitle}</Caption1>
			</div>
			<Toolbar aria-label={CO_WRITER_LABELS.commands} size="small" className={styles.toolbar}>
				{ready ? <ModelMenu /> : null}
				{ready ? (
					<Tooltip content={CO_WRITER_LABELS.newConversation} relationship="label">
						<ToolbarButton appearance="subtle" icon={<ComposeRegular />} disabledFocusable={!canRestart} onClick={() => canRestart && void newConversation(storyId)} />
					</Tooltip>
				) : null}
				<Tooltip content={CO_WRITER_LABELS.collapse} relationship="label">
					<ToolbarButton appearance="subtle" icon={<PanelRightContractRegular />} onClick={() => setDockCollapsed(true)} />
				</Tooltip>
			</Toolbar>
		</div>
	);
}

export function CoWriterPanel(): JSX.Element {
	const styles = useStyles();
	const status = useCodexStore((state) => state.status);
	const statusLoad = useCodexStore((state) => state.statusLoad);
	const loadStatus = useCodexStore((state) => state.loadStatus);
	const openConversation = useCodexStore((state) => state.openConversation);
	const storyId = useStoryStore((state) => state.selectedStoryId);
	const ready = status?.state === 'ready';

	useEffect(() => {
		void loadStatus();
	}, [loadStatus]);

	useEffect(() => {
		if (ready) {
			void openConversation(storyId);
		}
	}, [ready, storyId, openConversation]);

	return (
		<div className={styles.root} {...{ [CO_WRITER_STATE_ATTRIBUTE]: panelState(statusLoad, status?.state) }}>
			<PanelHeader storyId={storyId} ready={ready} />
			{ready && statusLoad !== 'loading' ? (
				<>
					<CoWriterTranscript storyId={storyId} />
					<CoWriterComposer storyId={storyId} />
				</>
			) : (
				<CoWriterSetup />
			)}
		</div>
	);
}
