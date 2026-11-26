// Scrollable list of a category's sub-prompts (it scrolls inside its card, whose height is bounded). DOM-only effects:
// scrolls the sub-prompt used by the current output into view when it changes, and scrolls to the bottom when a
// sub-prompt is added (never the board or the page: scrollWithin.ts).
import { makeStyles, tokens } from '@fluentui/react-components';
import { useEffect, useRef } from 'react';
import type { CategoryKey, SubPromptKey } from '../../domain/categories';
import { useSubPromptKeys } from '../../stores/categoriesStore';
import { useCurrentSelectionKey } from '../../stores/outputsStore';
import { scrollIntoContainer } from './scrollWithin';
import { SubPromptRow } from './SubPromptRow';

const useStyles = makeStyles({
	list: {
		position: 'relative',
		flex: '1 1 auto',
		minHeight: 0,
		overflowY: 'auto',
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalM,
		paddingLeft: tokens.spacingHorizontalS,
		paddingRight: tokens.spacingHorizontalS,
	},
});

export function SubPromptList({ categoryKey }: { categoryKey: CategoryKey }): JSX.Element {
	const styles = useStyles();
	const promptKeys = useSubPromptKeys(categoryKey);
	const currentKey = useCurrentSelectionKey(categoryKey);
	const listRef = useRef<HTMLDivElement>(null);
	const rowElements = useRef(new Map<SubPromptKey, HTMLDivElement>());
	const previousCount = useRef<number | null>(null);

	useEffect(() => {
		const list = listRef.current;
		const row = currentKey ? rowElements.current.get(currentKey) : undefined;
		if (list && row) {
			scrollIntoContainer(list, row);
		}
	}, [currentKey]);

	const count = promptKeys.length;
	useEffect(() => {
		const list = listRef.current;
		if (list && previousCount.current !== null && count > previousCount.current) {
			list.scrollTop = list.scrollHeight;
		}
		previousCount.current = count;
	}, [count]);

	return (
		<div ref={listRef} className={styles.list} role="list" aria-label="Sub-prompts">
			{promptKeys.map((promptKey) => (
				<div
					key={promptKey}
					role="listitem"
					ref={(element) => {
						if (element) {
							rowElements.current.set(promptKey, element);
						} else {
							rowElements.current.delete(promptKey);
						}
					}}
				>
					<SubPromptRow categoryKey={categoryKey} promptKey={promptKey} />
				</div>
			))}
		</div>
	);
}
