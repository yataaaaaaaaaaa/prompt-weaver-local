// Content of one category window (the workspace wraps it in a FloatingPane): header (name, activation
// text, priority, actions) and either the sub-prompt list or the bulk editor (ephemeral card mode).
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useState } from 'react';
import type { CategoryKey } from '../../domain/categories';
import { useCategoryUiState } from '../../stores/categoriesStore';
import { BulkSubPromptEditor } from './BulkSubPromptEditor';
import { CategoryHeader } from './CategoryHeader';
import { SubPromptList } from './SubPromptList';

export type CategoryCardProps = {
	categoryKey: CategoryKey;
};

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		height: '100%',
		minHeight: 0,
		boxSizing: 'border-box',
		color: tokens.colorNeutralForeground1,
	},
	skip: {
		backgroundColor: tokens.colorNeutralBackground3,
		color: tokens.colorNeutralForeground3,
	},
	indirectlyDisabled: {
		backgroundColor: tokens.colorNeutralBackground2,
		color: tokens.colorNeutralForeground3,
		outline: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`,
		outlineOffset: `calc(-1 * ${tokens.strokeWidthThin})`,
	},
});

export function CategoryCard({ categoryKey }: CategoryCardProps): JSX.Element {
	const styles = useStyles();
	const uiState = useCategoryUiState(categoryKey);
	const [bulkEditing, setBulkEditing] = useState(false);

	return (
		<div
			className={mergeClasses(
				styles.root,
				uiState === 'skip' && styles.skip,
				uiState === 'indirectly-disabled' && styles.indirectlyDisabled,
			)}
			data-ui-state={uiState}
		>
			<CategoryHeader categoryKey={categoryKey} onEditAll={() => setBulkEditing(true)} />
			{bulkEditing ? (
				<BulkSubPromptEditor categoryKey={categoryKey} onClose={() => setBulkEditing(false)} />
			) : (
				<SubPromptList categoryKey={categoryKey} />
			)}
		</div>
	);
}
