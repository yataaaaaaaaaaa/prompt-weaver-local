// Top app bar of the workspace: category actions, pane visibility toggles (one per registered pane),
// visibility mode and undo. Thin view over the categories, workspace and undo stores.
//
// Always ONE row: when everything does not fit the window width, the app title hides first (it stays the page
// heading for assistive technology), then the pane toggles become icon-only, then every item (useToolbarDensity).
// Every item keeps its accessible name (the pane title, 'Add category', 'Undo', ...) and its tooltip at every
// density, and stays in the toolbar (no overflow menu: the toggles' pressed state stays visible).
import {
	makeStyles,
	mergeClasses,
	Subtitle2,
	tokens,
	ToggleButton,
	Toolbar,
	ToolbarButton,
	ToolbarDivider,
	Tooltip,
} from '@fluentui/react-components';
import {
	AddRegular,
	ArrowUndoRegular,
	EyeRegular,
	GridRegular,
	LayoutCellFourRegular,
	WindowMultipleRegular,
	type FluentIcon,
} from '@fluentui/react-icons';
import { useCategoriesStore } from '../stores/categoriesStore';
import { selectCanUndo, useUndoStore } from '../stores/undoStore';
import { useIsPaneShown, useWorkspaceStore, type VisibilityMode } from '../stores/workspaceStore';
import { ariaKeyShortcuts, withShortcut } from '../ui/keyboard';
import { PANES, type PaneDefinition } from './paneRegistry';
import { isAtLeast, useToolbarDensity } from './useToolbarDensity';

const VISIBILITY_MODES: Record<VisibilityMode, { label: string; icon: FluentIcon }> = {
	all: { label: 'All windows', icon: EyeRegular },
	'categories-only': { label: 'Categories only', icon: GridRegular },
	'panes-only': { label: 'Panes only', icon: WindowMultipleRegular },
};

const useStyles = makeStyles({
	bar: {
		display: 'flex',
		alignItems: 'center',
		flexShrink: 0,
		gap: tokens.spacingHorizontalM,
		padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
		backgroundColor: tokens.colorNeutralBackground1,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		boxShadow: tokens.shadow2,
		zIndex: 1,
	},
	title: {
		margin: 0,
		whiteSpace: 'nowrap',
	},
	// Still the page heading for assistive technology, without taking room.
	visuallyHidden: {
		position: 'absolute',
		width: '1px',
		height: '1px',
		margin: '-1px',
		overflow: 'hidden',
		clipPath: 'inset(50%)',
	},
	// One row whose width follows the window: what does not fit is clipped (never wrapped) while useToolbarDensity
	// measures it and switches to a denser level before the browser paints.
	toolbar: {
		flex: 1,
		minWidth: 0,
		flexWrap: 'nowrap',
		overflow: 'hidden',
		'& > *': {
			flexShrink: 0,
		},
	},
});

/** The label as visible text, or (icon-only) as the accessible name only. */
function labelProps(label: string, showLabel: boolean): { children?: string; 'aria-label'?: string } {
	return showLabel ? { children: label } : { 'aria-label': label };
}


// A Fluent ToggleButton (not ToolbarToggleButton, whose checked state would have to be mirrored into the
// toolbar's checkedValues): pressed while the pane is on screen (useIsPaneShown). Showing a pane reveals it in front
// of every window (it may have been closed behind others) and leaves "categories only".
function PaneToggleButton({ pane, showLabel }: { pane: PaneDefinition; showLabel: boolean }): JSX.Element {
	const shown = useIsPaneShown(pane.id);
	const setPaneVisible = useWorkspaceStore((state) => state.setPaneVisible);
	const revealPane = useWorkspaceStore((state) => state.revealPane);
	const Icon = pane.icon;
	return (
		<Tooltip content={`${shown ? 'Hide' : 'Show'} the ${pane.title} pane`} relationship="description">
			<ToggleButton
				appearance="subtle"
				checked={shown}
				icon={<Icon />}
				onClick={() => (shown ? setPaneVisible(pane.id, false) : revealPane(pane.id))}
				{...labelProps(pane.title, showLabel)}
			/>
		</Tooltip>
	);
}

export function WorkspaceToolbar(): JSX.Element {
	const styles = useStyles();
	const addCategory = useCategoriesStore((state) => state.addCategory);
	const reorganize = useCategoriesStore((state) => state.reorganize);
	const visibilityMode = useWorkspaceStore((state) => state.visibilityMode);
	const cycleVisibilityMode = useWorkspaceStore((state) => state.cycleVisibilityMode);
	const canUndo = useUndoStore(selectCanUndo);
	const undo = useUndoStore((state) => state.undo);
	const mode = VISIBILITY_MODES[visibilityMode];
	const ModeIcon = mode.icon;
	const { containerRef, contentRef, density } = useToolbarDensity<HTMLElement, HTMLDivElement>(visibilityMode);
	const paneLabels = !isAtLeast(density, 'compact');
	const commandLabels = !isAtLeast(density, 'minimal');

	return (
		<header ref={containerRef} className={styles.bar}>
			<Subtitle2 as="h1" className={mergeClasses(styles.title, isAtLeast(density, 'untitled') && styles.visuallyHidden)}>
				Prompt Weaver
			</Subtitle2>
			<Toolbar ref={contentRef} aria-label="Workspace" className={styles.toolbar} data-density={density}>
				<Tooltip content="Add an empty category window" relationship="description">
					<ToolbarButton icon={<AddRegular />} onClick={() => addCategory()} {...labelProps('Add category', commandLabels)} />
				</Tooltip>
				<Tooltip
					content={withShortcut('Sort categories by priority and arrange their windows in a grid', 'reorganize-categories')}
					relationship="description"
				>
					<ToolbarButton
						icon={<LayoutCellFourRegular />}
						aria-keyshortcuts={ariaKeyShortcuts('reorganize-categories')}
						onClick={() => reorganize()}
						{...labelProps('Reorganize categories', commandLabels)}
					/>
				</Tooltip>
				<ToolbarDivider />
				{PANES.map((pane) => (
					<PaneToggleButton key={pane.id} pane={pane} showLabel={paneLabels} />
				))}
				<ToolbarDivider />
				<Tooltip content={withShortcut('Cycle visible windows: all, categories only, panes only', 'toggle-visibility')} relationship="description">
					<ToolbarButton
						icon={<ModeIcon />}
						aria-keyshortcuts={ariaKeyShortcuts('toggle-visibility')}
						onClick={() => cycleVisibilityMode()}
						{...labelProps(`Showing: ${mode.label}`, commandLabels)}
					/>
				</Tooltip>
				<Tooltip content={withShortcut('Undo the last generation or deletion', 'undo')} relationship="description">
					<ToolbarButton
						icon={<ArrowUndoRegular />}
						aria-keyshortcuts={ariaKeyShortcuts('undo')}
						disabled={!canUndo}
						onClick={() => void undo()}
						{...labelProps('Undo', commandLabels)}
					/>
				</Tooltip>
			</Toolbar>
		</header>
	);
}
