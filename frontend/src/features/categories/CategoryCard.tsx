// Body of one category window (CategoryWindows wraps it in a FloatingPane whose frame shows the category's visual
// state and whose header holds CategoryActions): name and activation text, then either the sub-prompt list or the
// bulk editor (ephemeral window mode, owned by the window).
import { makeStyles, tokens } from '@fluentui/react-components';
import type { CategoryKey } from '../../domain/categories';
import { BulkSubPromptEditor } from './BulkSubPromptEditor';
import { CategoryHeader } from './CategoryHeader';
import { SubPromptList } from './SubPromptList';

export type CategoryCardProps = {
	categoryKey: CategoryKey;
	/** The bulk editor replaces the list. */
	bulkEditing: boolean;
	/** The bulk editor applied or cancelled its text. */
	onBulkEditorClose: () => void;
};

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		height: '100%',
		minHeight: 0,
		color: tokens.colorNeutralForeground1,
	},
});

export function CategoryCard({ categoryKey, bulkEditing, onBulkEditorClose }: CategoryCardProps): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.root}>
			<CategoryHeader categoryKey={categoryKey} />
			{bulkEditing ? <BulkSubPromptEditor categoryKey={categoryKey} onClose={onBulkEditorClose} /> : <SubPromptList categoryKey={categoryKey} />}
		</div>
	);
}
