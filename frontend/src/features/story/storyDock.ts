// The docked side region of the Story section (after the scene details; src/ui/SectionLayout.tsx `dock`), where a
// panel working on the stories plugs in, e.g. a co-writer chat panel. THE place to register it: add its entry to
// STORY_DOCK_PANELS and the Story section renders it, as a complementary landmark named after it, an F6 region, in the
// storyboard and in the reader alike. Without a panel there is no dock (the other regions take its room).
//
// A dock panel is a thin view like every other: it reads the stories and acts on them through the story store's action
// API (src/stores/storyStore.ts: createStory, addScene, updateScene, lockSubPrompt, moveScene, generateScene,
// generateMissing, chooseVariant, ...), never through the API client, so no story rule is duplicated. It lays out its
// own scrolling inside the dock (the dock is a flex column that does not scroll). The dock can be collapsed to a strip
// (the story store's dockCollapsed / setDockCollapsed: a panel offers its own Collapse button, the strip Expand).
//
// Registered: the co-writer (src/features/coWriter/CoWriterPanel.tsx), the user's own Codex writing with them.
import type { ComponentType } from 'react';
import { CO_WRITER_LABELS } from '../coWriter/coWriterLabels';
import { CoWriterPanel } from '../coWriter/CoWriterPanel';

export type StoryDockPanel = {
	/** Accessible name of the dock (e.g. 'Co-writer'). */
	label: string;
	component: ComponentType;
};

/** The registered dock panels; the Story section shows the first one. Empty: no dock. */
export const STORY_DOCK_PANELS: readonly StoryDockPanel[] = [{ label: CO_WRITER_LABELS.panel, component: CoWriterPanel }];
