// Priority of a category (decimal allowed). The draft is ephemeral: every parseable value is committed to
// the categories store, and the draft follows the store when the value changes elsewhere (e.g. Reorganize).
import { Input, makeStyles, tokens, Tooltip } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { parsePriority, type CategoryKey } from '../../domain/categories';
import { findCategory, useCategoriesStore } from '../../stores/categoriesStore';

const useStyles = makeStyles({
	input: {
		width: '64px',
		minWidth: 0,
	},
	field: {
		textAlign: 'center',
		paddingLeft: tokens.spacingHorizontalXS,
		paddingRight: tokens.spacingHorizontalXS,
	},
});

export function PriorityField({ categoryKey }: { categoryKey: CategoryKey }): JSX.Element {
	const styles = useStyles();
	const priority = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.priority ?? 0);
	const setPriority = useCategoriesStore((state) => state.setPriority);
	const [draft, setDraft] = useState(() => String(priority));

	useEffect(() => {
		// Resync only when the store differs from what the draft means (keeps '1.' or '1.50' while typing).
		setDraft((current) => (parsePriority(current) === priority ? current : String(priority)));
	}, [priority]);

	return (
		<Tooltip content="Priority (Reorganize sorts categories by priority, then name)" relationship="description">
			<Input
				className={styles.input}
				input={{ className: styles.field }}
				size="small"
				aria-label="Priority"
				inputMode="decimal"
				value={draft}
				onChange={(_event, data) => {
					setDraft(data.value);
					const value = parsePriority(data.value);
					if (value !== null && value !== priority) {
						setPriority(categoryKey, value);
					}
				}}
				onBlur={() => setDraft(String(priority))}
			/>
		</Tooltip>
	);
}
