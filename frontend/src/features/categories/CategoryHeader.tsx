// Top of a category window's body: the inline-editable name and activation text. The window's commands live in its
// FloatingPane header (CategoryActions), so the body starts with the name.
import { makeStyles, tokens } from '@fluentui/react-components';
import type { CategoryKey } from '../../domain/categories';
import { findCategory, useCategoriesStore } from '../../stores/categoriesStore';
import { InlineEditableText } from './InlineEditableText';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		flexShrink: 0,
		gap: tokens.spacingVerticalXXS,
		paddingTop: tokens.spacingVerticalXS,
		paddingBottom: tokens.spacingVerticalXS,
		paddingLeft: tokens.spacingHorizontalXS,
		paddingRight: tokens.spacingHorizontalXS,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
});

export function CategoryHeader({ categoryKey }: { categoryKey: CategoryKey }): JSX.Element | null {
	const styles = useStyles();
	const text = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.text);
	const activationText = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.activation_text ?? '');
	const renameCategory = useCategoriesStore((state) => state.renameCategory);
	const setActivationText = useCategoriesStore((state) => state.setActivationText);

	if (text === undefined) {
		return null;
	}

	return (
		<div className={styles.root}>
			<InlineEditableText
				value={text}
				label="Category name"
				placeholder="Unnamed category"
				variant="title"
				rows={1}
				onCommit={(next) => renameCategory(categoryKey, next)}
			/>
			<InlineEditableText
				value={activationText}
				label="Activation text"
				placeholder="Activation text (optional)"
				variant="caption"
				rows={1}
				onCommit={(next) => setActivationText(categoryKey, next)}
			/>
		</div>
	);
}
