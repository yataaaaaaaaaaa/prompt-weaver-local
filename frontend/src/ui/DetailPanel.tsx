// The content frame of the detail panel of the full-page library sections (Models, Images; the panel itself is
// SectionLayout's complementary region): the selected item's heading with a Close button, then its content. One
// keyboard contract for both sections:
// - when an item opens (or another one replaces it) its heading takes the focus, so a screen reader announces it and
//   Tab continues into its actions;
// - Escape (unless an open menu or tooltip handled it) or Close clears the selection (onClose, a store action) and
//   moves the focus back to the control that opened the item: the results mark their openers with
//   detailOpenerProps(key); an item no longer listed sends the focus to the results region instead.
// While nothing is selected a detail panel shows an EmptyState (src/ui/EmptyState.tsx): what to pick and what the
// panel will show then.
import { Button, createFocusOutlineStyle, makeStyles, tokens, Tooltip, typographyStyles } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { F6_REGION_ATTRIBUTE } from '../app/sections';

/** Attribute naming the item a results control opens in the detail panel (its value is the item's key). */
export const DETAIL_OPENER_ATTRIBUTE = 'data-detail-opener';

/** Props marking the control that opens the item `key` in the detail panel (the focus returns to it on close). */
export function detailOpenerProps(key: string): Readonly<Record<typeof DETAIL_OPENER_ATTRIBUTE, string>> {
	return { [DETAIL_OPENER_ATTRIBUTE]: key };
}

/** Accessible name (and tooltip) of the Close button of every detail panel. */
export const CLOSE_DETAIL_LABEL = 'Close details';

/** Where the focus goes when the detail of `key` closes: its opener inside `scope`, else the results region. */
function closeFocusTarget(scope: ParentNode, key: string): HTMLElement | null {
	const openers = Array.from(scope.querySelectorAll<HTMLElement>(`[${DETAIL_OPENER_ATTRIBUTE}]`));
	return (
		openers.find((element) => element.getAttribute(DETAIL_OPENER_ATTRIBUTE) === key) ??
		scope.querySelector<HTMLElement>(`[${F6_REGION_ATTRIBUTE}="results"]`)
	);
}

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalXL}`,
		minWidth: 0,
	},
	header: {
		display: 'flex',
		alignItems: 'flex-start',
		gap: tokens.spacingHorizontalS,
		minWidth: 0,
	},
	title: {
		...typographyStyles.subtitle1,
		flex: '1 1 auto',
		minWidth: 0,
		margin: 0,
		paddingTop: tokens.spacingVerticalXXS,
		overflowWrap: 'anywhere',
		borderRadius: tokens.borderRadiusMedium,
		...createFocusOutlineStyle(),
	},
});

export type DetailPanelProps = {
	/** Key of the shown item (its opener carries detailOpenerProps(itemKey)). */
	itemKey: string;
	/** The item's name (the panel heading). */
	title: string;
	/** Clears the selection (a store action); the focus is moved by the panel. */
	onClose: () => void;
	children: ReactNode;
};

export function DetailPanel({ itemKey, title, onClose, children }: DetailPanelProps): JSX.Element {
	const styles = useStyles();
	const rootRef = useRef<HTMLDivElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		headingRef.current?.focus();
	}, [itemKey]);

	const close = () => {
		const root = rootRef.current;
		const target = root ? closeFocusTarget(root.closest('main') ?? root.ownerDocument, itemKey) : null;
		onClose();
		target?.focus();
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Open menus and tooltips handle (and prevent) their own Escape first.
		if (event.key === 'Escape' && !event.defaultPrevented) {
			event.preventDefault();
			close();
		}
	};

	return (
		<div ref={rootRef} className={styles.root} onKeyDown={handleKeyDown}>
			<div className={styles.header}>
				<h2 ref={headingRef} tabIndex={-1} className={styles.title}>
					{title}
				</h2>
				<Tooltip content={`${CLOSE_DETAIL_LABEL} (Esc)`} relationship="description">
					<Button appearance="subtle" icon={<DismissRegular />} aria-label={CLOSE_DETAIL_LABEL} onClick={close} />
				</Tooltip>
			</div>
			{children}
		</div>
	);
}
