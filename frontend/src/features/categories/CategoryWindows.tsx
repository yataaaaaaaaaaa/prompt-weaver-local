// One workspace window per prompt category (the workspace shell renders <CategoryWindows /> on its surface). The
// window frame shows the category's semantic state through FloatingPane's frameState (forbiddenRulesStore
// useCategoryWindowState; colors: src/ui/stateColors.ts), its header holds the category's commands (CategoryActions)
// and its body the name, activation text and sub-prompts (CategoryCard).
import { useState } from 'react';
import { categoryDefaultLayout } from '../../domain/categories';
import { categoryWindowKey } from '../../domain/layout';
import { findCategory, useCategoriesStore, useCategoryKeys } from '../../stores/categoriesStore';
import { useCategoryWindowState } from '../../stores/forbiddenRulesStore';
import { FloatingPane } from '../../workspace/FloatingPane';
import { CategoryActions } from './CategoryActions';
import { CategoryCard } from './CategoryCard';

// The cascade of windows without a stored layout (defined with the category model; re-exported for the workspace).
export { categoryDefaultLayout };

function CategoryWindow({ categoryKey, index }: { categoryKey: string; index: number }): JSX.Element {
	const text = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.text ?? categoryKey);
	const frameState = useCategoryWindowState(categoryKey);
	// Ephemeral window mode: the bulk editor replaces the sub-prompt list.
	const [bulkEditing, setBulkEditing] = useState(false);
	return (
		<FloatingPane
			windowKey={categoryWindowKey(categoryKey)}
			defaultLayout={categoryDefaultLayout(index)}
			ariaLabel={`${text} category`}
			frameState={frameState}
			headerActions={<CategoryActions categoryKey={categoryKey} onEditAll={() => setBulkEditing(true)} />}
		>
			<CategoryCard categoryKey={categoryKey} bulkEditing={bulkEditing} onBulkEditorClose={() => setBulkEditing(false)} />
		</FloatingPane>
	);
}

export function CategoryWindows(): JSX.Element {
	const keys = useCategoryKeys();
	return (
		<>
			{keys.map((key, index) => (
				<CategoryWindow key={key} categoryKey={key} index={index} />
			))}
		</>
	);
}
