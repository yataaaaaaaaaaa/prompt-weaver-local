// Pane registry: the ONE place where workspace panes are declared. The workspace shell renders a
// FloatingPane per entry and the toolbar lists them (show/hide). Future panes (Model library, Image
// library, Characters) plug in by adding an entry here (their store first, then the view).
import type { FluentIcon } from '@fluentui/react-icons';
import { ImageMultipleRegular, ImageRegular, LibraryRegular, OptionsRegular, TextBulletListSquareRegular } from '@fluentui/react-icons';
import type { ComponentType } from 'react';
import type { Rect } from '../domain/layout';
import { UsedSelectionsPane } from '../features/forbidden/UsedSelectionsPane';
import { ControlsPane } from '../features/generation/ControlsPane';
import { ModelLibraryPane } from '../features/models/ModelLibraryPane';
import { ImagePane } from '../features/outputs/ImagePane';
import { OutputBrowserPane } from '../features/outputs/OutputBrowserPane';

export type PaneDefinition = {
	/** Stable id; the window key is paneWindowKey(id) ('pane:<id>'). Never rename: layouts are persisted. */
	id: string;
	title: string;
	/** Unsized Fluent icon (sizes itself to the surrounding font size / button icon slot). */
	icon: FluentIcon;
	defaultLayout: Rect;
	minWidth?: number;
	minHeight?: number;
	component: ComponentType;
};

export const PANES: readonly PaneDefinition[] = [
	{
		id: 'image',
		title: 'Image',
		icon: ImageRegular,
		defaultLayout: { x: 24, y: 24, width: 640, height: 720 },
		component: ImagePane,
	},
	{
		id: 'browser',
		title: 'Output browser',
		icon: ImageMultipleRegular,
		defaultLayout: { x: 690, y: 24, width: 360, height: 280 },
		component: OutputBrowserPane,
	},
	{
		id: 'controls',
		title: 'Generation',
		icon: OptionsRegular,
		defaultLayout: { x: 1060, y: 24, width: 420, height: 720 },
		component: ControlsPane,
	},
	{
		id: 'used',
		title: 'Used sub-prompts',
		icon: TextBulletListSquareRegular,
		defaultLayout: { x: 690, y: 320, width: 790, height: 420 },
		component: UsedSelectionsPane,
	},
	{
		id: 'models',
		title: 'Model library',
		icon: LibraryRegular,
		defaultLayout: { x: 1490, y: 24, width: 560, height: 760 },
		minWidth: 360,
		minHeight: 320,
		component: ModelLibraryPane,
	},
];
