// The prompt board's empty states (Fluent 2 empty-state pattern: icon, title, explanation, actions). Without any
// category: how the board works, 'Add your first category', and 'Browse images' (Images section: the tags of an
// online image can become a category). With categories all hidden by the filter: what is filtered and 'Clear filter'.
import { Button } from '@fluentui/react-components';
import { AddRegular, AppsListRegular, FilterDismissRegular, ImageSearchRegular, SearchRegular } from '@fluentui/react-icons';
import { BOARD_STATE_FILTER_LABELS } from '../../domain/board';
import { useBoardStore } from '../../stores/boardStore';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { EmptyState } from '../../ui/EmptyState';

/** No category at all (first run). */
export function NoCategoriesState(): JSX.Element {
	const addCategory = useCategoriesStore((state) => state.addCategory);
	const showSection = useNavigationStore((state) => state.showSection);
	return (
		<EmptyState
			icon={AppsListRegular}
			title="No categories yet"
			emphasis
			actions={
				<>
					<Button appearance="primary" icon={<AddRegular />} onClick={() => addCategory()}>
						Add your first category
					</Button>
					<Button icon={<ImageSearchRegular />} onClick={() => showSection('images')}>
						Browse images
					</Button>
				</>
			}
		>
			<p>
				A category holds alternative sub-prompts, such as hair colors or outfits. Each generation picks one sub-prompt from every
				active category, in priority order.
			</p>
			<p>Found an online image you like? In Images, its tags can become a category in one click.</p>
		</EmptyState>
	);
}

/** Categories exist but the search / state filter hides them all. */
export function NoMatchState(): JSX.Element {
	const query = useBoardStore((state) => state.filter.query.trim());
	const stateFilter = useBoardStore((state) => state.filter.state);
	const clearFilter = useBoardStore((state) => state.clearFilter);
	const parts = [query ? `'${query}'` : null, stateFilter === 'any' ? null : BOARD_STATE_FILTER_LABELS[stateFilter].toLowerCase()].filter(Boolean);
	return (
		<EmptyState
			icon={SearchRegular}
			title="No category matches"
			actions={
				<Button icon={<FilterDismissRegular />} onClick={clearFilter}>
					Clear filter
				</Button>
			}
		>
			Nothing matches {parts.join(', ')}. The search looks in names, activation texts and sub-prompts.
		</EmptyState>
	);
}

/** The board's empty state: no category at all, or none matching the filter. */
export function BoardEmptyState({ hasCategories }: { hasCategories: boolean }): JSX.Element {
	return hasCategories ? <NoMatchState /> : <NoCategoriesState />;
}
