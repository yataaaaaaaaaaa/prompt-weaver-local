// The workspace shell: top app bar + scrollable surface of floating windows (one per category, rendered by the
// categories feature, and one per registered pane). Visibility (mode, closed panes) and layouts come from the
// workspace store.
import { makeStyles, tokens } from '@fluentui/react-components';
import { paneWindowKey } from '../domain/layout';
import { CategoryWindows } from '../features/categories/CategoryWindows';
import { selectShowCategories, useIsPaneShown, useWorkspaceStore } from '../stores/workspaceStore';
import { FloatingPane } from './FloatingPane';
import { PANES, type PaneDefinition } from './paneRegistry';
import { WorkspaceToolbar } from './WorkspaceToolbar';

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

function PaneWindow({ pane }: { pane: PaneDefinition }): JSX.Element | null {
	const shown = useIsPaneShown(pane.id);
	const setPaneVisible = useWorkspaceStore((state) => state.setPaneVisible);
	if (!shown) {
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
	return (
		<div className={styles.root}>
			<WorkspaceToolbar />
			<main className={styles.surface} aria-label="Workspace windows">
				{showCategories ? <CategoryWindows /> : null}
				{PANES.map((pane) => (
					<PaneWindow key={pane.id} pane={pane} />
				))}
			</main>
		</div>
	);
}
