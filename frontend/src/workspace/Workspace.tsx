// The workspace shell: top app bar + scrollable surface of floating windows (one per category, one per
// registered pane). Visibility (mode, closed panes) and layouts come from the workspace store.
import { makeStyles, tokens } from '@fluentui/react-components';
import { categoryWindowKey, paneWindowKey, type Rect } from '../domain/layout';
import { CategoryCard } from '../features/categories/CategoryCard';
import { findCategory, useCategoriesStore, useCategoryKeys } from '../stores/categoriesStore';
import { selectShowCategories, selectShowPanes, useIsPaneVisible, useWorkspaceStore } from '../stores/workspaceStore';
import { FloatingPane } from './FloatingPane';
import { PANES, type PaneDefinition } from './paneRegistry';
import { WorkspaceToolbar } from './WorkspaceToolbar';

/** Where a category window without a stored layout is drawn: cascaded by its position in the list. */
export function categoryDefaultLayout(index: number): Rect {
	return { x: 40 + 24 * index, y: 40 + 24 * index, width: 500, height: 300 };
}

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		height: '100%',
	},
	surface: {
		position: 'relative',
		flex: 1,
		minHeight: 0,
		overflow: 'auto',
		// Window z-indexes stay inside the surface; overlays (notifications, Fluent portals) stay above.
		isolation: 'isolate',
		backgroundColor: tokens.colorNeutralBackground2,
		backgroundImage: `radial-gradient(${tokens.colorNeutralStroke2} ${tokens.strokeWidthThin}, ${tokens.colorTransparentBackground} ${tokens.strokeWidthThin})`,
		backgroundSize: `${tokens.spacingHorizontalXXL} ${tokens.spacingVerticalXXL}`,
		backgroundAttachment: 'local',
	},
});

function CategoryWindow({ categoryKey, index }: { categoryKey: string; index: number }): JSX.Element {
	const text = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.text ?? categoryKey);
	return (
		<FloatingPane windowKey={categoryWindowKey(categoryKey)} defaultLayout={categoryDefaultLayout(index)} ariaLabel={`${text} category`}>
			<CategoryCard categoryKey={categoryKey} />
		</FloatingPane>
	);
}

function CategoryWindows(): JSX.Element {
	const keys = useCategoryKeys();
	return (
		<>
			{keys.map((key, index) => (
				<CategoryWindow key={key} categoryKey={key} index={index} />
			))}
		</>
	);
}

function PaneWindow({ pane }: { pane: PaneDefinition }): JSX.Element | null {
	const visible = useIsPaneVisible(pane.id);
	const setPaneVisible = useWorkspaceStore((state) => state.setPaneVisible);
	if (!visible) {
		return null;
	}
	const Content = pane.component;
	return (
		<FloatingPane
			windowKey={paneWindowKey(pane.id)}
			defaultLayout={pane.defaultLayout}
			title={pane.title}
			icon={pane.icon}
			minWidth={pane.minWidth}
			minHeight={pane.minHeight}
			onClose={() => setPaneVisible(pane.id, false)}
		>
			<Content />
		</FloatingPane>
	);
}

export function Workspace(): JSX.Element {
	const styles = useStyles();
	const showCategories = useWorkspaceStore(selectShowCategories);
	const showPanes = useWorkspaceStore(selectShowPanes);
	return (
		<div className={styles.root}>
			<WorkspaceToolbar />
			<main className={styles.surface} aria-label="Workspace windows">
				{showCategories ? <CategoryWindows /> : null}
				{showPanes ? PANES.map((pane) => <PaneWindow key={pane.id} pane={pane} />) : null}
			</main>
		</div>
	);
}
