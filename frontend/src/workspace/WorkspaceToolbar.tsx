// Top app bar of the workspace: category actions, pane visibility toggles (one per registered pane),
// visibility mode and undo. Thin view over the categories, workspace and undo stores.
import {
	makeStyles,
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
import { useIsPaneVisible, useWorkspaceStore, type VisibilityMode } from '../stores/workspaceStore';
import { ariaKeyShortcuts, withShortcut } from '../ui/keyboard';
import { PANES, type PaneDefinition } from './paneRegistry';

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
	toolbar: {
		flex: 1,
		minWidth: 0,
		flexWrap: 'wrap',
	},
});

// A Fluent ToggleButton (not ToolbarToggleButton, whose checked state would have to be mirrored into the
// toolbar's checkedValues): its pressed state reads the workspace store directly.
function PaneToggleButton({ pane }: { pane: PaneDefinition }): JSX.Element {
	const visible = useIsPaneVisible(pane.id);
	const setPaneVisible = useWorkspaceStore((state) => state.setPaneVisible);
	const Icon = pane.icon;
	return (
		<Tooltip content={`${visible ? 'Hide' : 'Show'} the ${pane.title} pane`} relationship="description">
			<ToggleButton appearance="subtle" checked={visible} icon={<Icon />} onClick={() => setPaneVisible(pane.id, !visible)}>
				{pane.title}
			</ToggleButton>
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

	return (
		<header className={styles.bar}>
			<Subtitle2 as="h1" className={styles.title}>
				Prompt Weaver
			</Subtitle2>
			<Toolbar aria-label="Workspace" className={styles.toolbar}>
				<Tooltip content="Add an empty category window" relationship="description">
					<ToolbarButton icon={<AddRegular />} onClick={() => addCategory()}>
						Add category
					</ToolbarButton>
				</Tooltip>
				<Tooltip content={withShortcut('Sort categories by priority and arrange their windows in a grid', 'reorganize-categories')} relationship="description">
					<ToolbarButton icon={<LayoutCellFourRegular />} aria-keyshortcuts={ariaKeyShortcuts('reorganize-categories')} onClick={() => reorganize()}>
						Reorganize categories
					</ToolbarButton>
				</Tooltip>
				<ToolbarDivider />
				{PANES.map((pane) => (
					<PaneToggleButton key={pane.id} pane={pane} />
				))}
				<ToolbarDivider />
				<Tooltip content={withShortcut('Cycle visible windows: all, categories only, panes only', 'toggle-visibility')} relationship="description">
					<ToolbarButton icon={<ModeIcon />} aria-keyshortcuts={ariaKeyShortcuts('toggle-visibility')} onClick={() => cycleVisibilityMode()}>
						{`Showing: ${mode.label}`}
					</ToolbarButton>
				</Tooltip>
				<Tooltip content={withShortcut('Undo the last generation or deletion', 'undo')} relationship="description">
					<ToolbarButton icon={<ArrowUndoRegular />} aria-keyshortcuts={ariaKeyShortcuts('undo')} disabled={!canUndo} onClick={() => void undo()}>
						Undo
					</ToolbarButton>
				</Tooltip>
			</Toolbar>
		</header>
	);
}
