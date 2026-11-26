// The output filmstrip of the viewer: a horizontal listbox ('Outputs') of thumbnails (the backend's small WebP copies,
// loaded lazily) of a window of outputs around the current one (outputs store selectFilmstripIds: a history of thousands
// of outputs never renders thousands of pictures), oldest on the left. Clicking a thumbnail shows its output; inside the
// listbox the arrow keys show the previous / next output and Home / End the first / last (the focus follows the current
// output: roving tabindex), and the current thumbnail is scrolled into view. 'Jump to latest' appears while an older
// output is shown.
//
// The thumbnails have an empty alt inside options named 'Output <id>': the current picture stays the only image of that
// name. The selection is marked by the 'current' frame of src/ui/stateStyles.tsx (plus aria-selected), never by color
// alone: the selected thumbnail also has the thick frame. Focus, scrolling and the failed thumbnails are view state.
import { Button, makeStyles, mergeClasses, tokens, Tooltip } from '@fluentui/react-components';
import { ArrowNext20Regular, ImageOffRegular } from '@fluentui/react-icons';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { outputThumbnailUrl } from '../../api/config';
import { selectFilmstripIds, selectLatestOutputId, useOutputsStore } from '../../stores/outputsStore';
import { useStateFrameClasses } from '../../ui/stateStyles';
import { outputPictureName, VIEWER_LABELS } from './viewerLabels';

/** Side of a thumbnail (CSS px; the backend's thumbnails are at most 256 px, OUTPUT_THUMBNAIL_MAX_SIDE). */
const THUMBNAIL_SIZE = 64;

const useStyles = makeStyles({
	root: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
		flexShrink: 0,
		minWidth: 0,
		paddingLeft: tokens.spacingHorizontalS,
		paddingRight: tokens.spacingHorizontalS,
		borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
	},
	strip: {
		// The offset parent of the thumbnails (scrollOptionIntoView).
		position: 'relative',
		display: 'flex',
		gap: tokens.spacingHorizontalXS,
		flex: 1,
		minWidth: 0,
		overflowX: 'auto',
		overflowY: 'hidden',
		scrollbarWidth: 'thin',
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		// Room for the focus outline of the first and last thumbnails.
		paddingLeft: tokens.strokeWidthThick,
		paddingRight: tokens.strokeWidthThick,
		outlineStyle: 'none',
	},
	option: {
		position: 'relative',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		flexShrink: 0,
		width: `${THUMBNAIL_SIZE}px`,
		height: `${THUMBNAIL_SIZE}px`,
		boxSizing: 'border-box',
		borderRadius: tokens.borderRadiusMedium,
		border: `${tokens.strokeWidthThick} solid transparent`,
		backgroundColor: tokens.colorNeutralBackground3,
		color: tokens.colorNeutralForeground3,
		cursor: 'pointer',
		overflow: 'hidden',
		':focus-visible': {
			outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
			outlineOffset: tokens.strokeWidthThin,
		},
	},
	// Hover feedback of the other thumbnails (the selected one keeps its frame).
	unselected: {
		':hover': {
			borderTopColor: tokens.colorNeutralStroke1Hover,
			borderRightColor: tokens.colorNeutralStroke1Hover,
			borderBottomColor: tokens.colorNeutralStroke1Hover,
			borderLeftColor: tokens.colorNeutralStroke1Hover,
		},
	},
	thumbnail: {
		display: 'block',
		width: '100%',
		height: '100%',
		objectFit: 'cover',
	},
	missing: {
		fontSize: tokens.fontSizeBase500,
	},
	jump: {
		flexShrink: 0,
	},
});

function Thumbnail({ outputId, selected, tabbable }: { outputId: string; selected: boolean; tabbable: boolean }): JSX.Element {
	const styles = useStyles();
	const frame = useStateFrameClasses();
	const select = useOutputsStore((state) => state.select);
	const [failed, setFailed] = useState(false);
	return (
		<div
			role="option"
			aria-label={outputPictureName(outputId)}
			aria-selected={selected}
			tabIndex={tabbable ? 0 : -1}
			data-output-id={outputId}
			className={mergeClasses(styles.option, selected ? frame.card.current : styles.unselected)}
			onClick={() => void select(outputId)}
		>
			{failed ? (
				<ImageOffRegular aria-hidden className={styles.missing} />
			) : (
				<img
					className={styles.thumbnail}
					src={outputThumbnailUrl(outputId)}
					alt=""
					loading="lazy"
					decoding="async"
					draggable={false}
					onError={() => setFailed(true)}
				/>
			)}
		</div>
	);
}

/** Scrolls the strip (only the strip: never its ancestors) so the option is in view, centered when possible. */
function scrollOptionIntoView(strip: HTMLElement, option: HTMLElement): void {
	const target = option.offsetLeft - (strip.clientWidth - option.offsetWidth) / 2;
	strip.scrollLeft = Math.max(0, Math.min(target, strip.scrollWidth - strip.clientWidth));
}

export function Filmstrip(): JSX.Element | null {
	const styles = useStyles();
	const ids = useOutputsStore(useShallow((state) => selectFilmstripIds(state)));
	const currentId = useOutputsStore((state) => state.currentId);
	const latestId = useOutputsStore(selectLatestOutputId);
	const previous = useOutputsStore((state) => state.previous);
	const next = useOutputsStore((state) => state.next);
	const first = useOutputsStore((state) => state.first);
	const last = useOutputsStore((state) => state.last);
	const stripRef = useRef<HTMLDivElement>(null);
	const currentListed = currentId !== null && ids.includes(currentId);
	const tabbableId = currentListed ? currentId : (ids[ids.length - 1] ?? null);

	// The current thumbnail stays in view, and keeps the focus when the focus was in the strip (focus follows the
	// selection of the arrow keys, Home and End).
	useLayoutEffect(() => {
		const strip = stripRef.current;
		const option = strip?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
		if (!strip || !option) {
			return;
		}
		scrollOptionIntoView(strip, option);
		if (strip.contains(document.activeElement) && document.activeElement !== option) {
			option.focus({ preventScroll: true });
		}
	}, [currentId, ids]);

	if (ids.length === 0) {
		return null;
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const move: Partial<Record<string, () => Promise<void>>> = {
			ArrowLeft: previous,
			ArrowUp: previous,
			ArrowRight: next,
			ArrowDown: next,
			Home: first,
			End: last,
		};
		const action = event.ctrlKey || event.metaKey || event.altKey ? undefined : move[event.key];
		if (action) {
			event.preventDefault();
			void action();
		}
	};

	return (
		<div className={styles.root}>
			<div
				ref={stripRef}
				role="listbox"
				aria-label={VIEWER_LABELS.filmstrip}
				aria-orientation="horizontal"
				className={styles.strip}
				onKeyDown={onKeyDown}
			>
				{ids.map((outputId) => (
					<Thumbnail key={outputId} outputId={outputId} selected={outputId === currentId} tabbable={outputId === tabbableId} />
				))}
			</div>
			{latestId !== null && currentId !== latestId ? (
				<Tooltip content={`Show the latest output, #${latestId}`} relationship="description">
					<Button className={styles.jump} size="small" appearance="subtle" icon={<ArrowNext20Regular />} onClick={() => void last()}>
						{VIEWER_LABELS.jumpToLatest}
					</Button>
				</Tooltip>
			) : null}
		</div>
	);
}
