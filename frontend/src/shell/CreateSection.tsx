// The Create section: a header row (the compact command bar, CreateCommandBar, then the 'Layout' toolbar), then three
// docked regions side by side, left to right: the prompt board, the current image (viewer) and the generation panel
// (ids and names: src/app/sections.ts).
//
// - Widths: the regions row is measured (ephemeral view state) and fitted by src/domain/layout.ts fitRegions from the
//   layout store's stored widths and collapsed regions: the board takes the rest, the viewer then the generation panel
//   shrink first when the window is small, nothing overflows at 1280 x 720.
// - Splitters (src/ui/Splitter.tsx) on the start side of the viewer and of the generation panel resize them (the board
//   pays); the dragged width is a draft until the pointer is released, then layoutStore.setRegionWidth. Enter on a
//   splitter collapses its region and moves the focus to that region's Expand button.
// - Collapse: the 'Layout' toolbar has one toggle per region (pressed while expanded) and the Ctrl+H cycle; a collapsed
//   region is a strip with its 'Expand <region>' button and its name, and the collapsed generation panel keeps its
//   compact actions (GenerationActionsCompact) so Generate is always one click away. The last expanded region cannot
//   be collapsed.
// - Landmarks: each region is a <section aria-label={CREATE_REGION_LABELS[id]}> and an F6 region (id); the header row is
//   the F6 region 'commands'. The region contents fill a flex column and scroll themselves.
import {
	Button,
	makeStyles,
	mergeClasses,
	Toolbar,
	ToolbarButton,
	ToolbarDivider,
	ToolbarToggleButton,
	Tooltip,
	tokens,
	typographyStyles,
	useId,
} from '@fluentui/react-components';
import type { FluentIcon } from '@fluentui/react-icons';
import { BoardRegular, ImageRegular, LayoutColumnThreeRegular, OptionsRegular, PanelLeftExpandRegular, PanelRightExpandRegular } from '@fluentui/react-icons';
import { Fragment, memo, useEffect, useRef, useState, type ComponentType } from 'react';
import { CREATE_REGION_IDS, CREATE_REGION_LABELS, F6_REGION_ATTRIBUTE, type CreateRegionId } from '../app/sections';
import {
	COLLAPSED_REGION_WIDTH,
	fitRegions,
	hasSplitter,
	isLastExpandedRegion,
	isResizableRegion,
	regionWidthRange,
	type RegionBoxes,
	type ResizableRegionId,
} from '../domain/layout';
import { PromptBoard } from '../features/categories/PromptBoard';
import { CreateCommandBar } from '../features/generation/CreateCommandBar';
import { GenerationActionsCompact, GenerationPanel } from '../features/generation/GenerationPanel';
import { OutputViewer } from '../features/outputs/OutputViewer';
import { useLayoutStore } from '../stores/layoutStore';
import { ariaKeyShortcuts, commandLabel, withShortcut } from '../ui/keyboard';
import { Splitter } from '../ui/Splitter';
import { useElementWidth } from './useElementWidth';

/** Accessible name of the toolbar of region toggles. */
export const LAYOUT_TOOLBAR_LABEL = 'Layout';
/** Marks the Expand button of a collapsed region's strip (value: the region id). */
export const EXPAND_REGION_ATTRIBUTE = 'data-expand-region';

export function expandRegionLabel(region: CreateRegionId): string {
	return `Expand ${CREATE_REGION_LABELS[region]}`;
}

export function resizeRegionLabel(region: CreateRegionId): string {
	return `Resize ${CREATE_REGION_LABELS[region]}`;
}

const REGION_ICONS: Readonly<Record<CreateRegionId, FluentIcon>> = {
	board: BoardRegular,
	viewer: ImageRegular,
	generation: OptionsRegular,
};

/** The strip's Expand icon points to where the region grows. */
const EXPAND_ICONS: Readonly<Record<CreateRegionId, FluentIcon>> = {
	board: PanelLeftExpandRegular,
	viewer: PanelRightExpandRegular,
	generation: PanelRightExpandRegular,
};

/** Region contents, memoized: resizing re-renders the section, never the board, the viewer or the panel. */
const REGION_CONTENT: Readonly<Record<CreateRegionId, ComponentType>> = {
	board: memo(PromptBoard),
	viewer: memo(OutputViewer),
	generation: memo(GenerationPanel),
};

const CompactGenerationActions = memo(GenerationActionsCompact);

const regionFocusRing = {
	':focus-visible': {
		outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
		outlineOffset: `calc(-1 * ${tokens.strokeWidthThick})`,
	},
} as const;

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		height: '100%',
		minHeight: 0,
		minWidth: 0,
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
		minWidth: 0,
		paddingRight: tokens.spacingHorizontalS,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
		...regionFocusRing,
	},
	commandBar: {
		flex: 1,
		minWidth: 0,
	},
	layoutToolbar: {
		flexShrink: 0,
	},
	regions: {
		display: 'flex',
		flex: 1,
		minHeight: 0,
		minWidth: 0,
		overflowX: 'auto',
		overflowY: 'hidden',
	},
	region: {
		display: 'flex',
		flexDirection: 'column',
		flexShrink: 0,
		minHeight: 0,
		minWidth: 0,
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground1,
		...regionFocusRing,
	},
	/** Before the first measure (one layout pass): the board takes the rest. */
	unmeasuredFill: {
		flex: 1,
	},
	board: {
		backgroundColor: tokens.colorNeutralBackground2,
	},
	divider: {
		borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
	collapsed: {
		backgroundColor: tokens.colorNeutralBackground3,
	},
	content: {
		display: 'flex',
		flexDirection: 'column',
		flex: 1,
		minHeight: 0,
		minWidth: 0,
	},
	contentHidden: {
		display: 'none',
	},
	strip: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalS,
		flex: 1,
		minHeight: 0,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		overflow: 'hidden',
	},
	stripLabel: {
		writingMode: 'vertical-rl',
		whiteSpace: 'nowrap',
		color: tokens.colorNeutralForeground2,
		...typographyStyles.caption1Strong,
	},
});

type Draft = { region: ResizableRegionId; width: number };

function LayoutToolbar(): JSX.Element {
	const styles = useStyles();
	const collapsed = useLayoutStore((state) => state.collapsed);
	const setRegionCollapsed = useLayoutStore((state) => state.setRegionCollapsed);
	const cycleFocusLayout = useLayoutStore((state) => state.cycleFocusLayout);
	const cycleLabel = commandLabel('cycle-create-layout');
	return (
		<Toolbar
			aria-label={LAYOUT_TOOLBAR_LABEL}
			size="small"
			className={styles.layoutToolbar}
			checkedValues={{ regions: CREATE_REGION_IDS.filter((region) => !collapsed[region]) }}
			onCheckedValueChange={(_event, data) => {
				for (const region of CREATE_REGION_IDS) {
					setRegionCollapsed(region, !data.checkedItems.includes(region));
				}
			}}
		>
			{CREATE_REGION_IDS.map((region) => {
				const Icon = REGION_ICONS[region];
				const label = CREATE_REGION_LABELS[region];
				const last = isLastExpandedRegion(collapsed, region);
				const hint = last ? `${label} stays shown: at least one region is shown` : `${collapsed[region] ? 'Expand' : 'Collapse'} ${label}`;
				return (
					<Tooltip key={region} content={hint} relationship="description">
						<ToolbarToggleButton
							appearance="subtle"
							aria-label={label}
							name="regions"
							value={region}
							icon={<Icon />}
							disabledFocusable={last}
						/>
					</Tooltip>
				);
			})}
			<ToolbarDivider />
			<Tooltip content={withShortcut(cycleLabel, 'cycle-create-layout')} relationship="description">
				<ToolbarButton
					appearance="subtle"
					aria-label={cycleLabel}
					aria-keyshortcuts={ariaKeyShortcuts('cycle-create-layout')}
					icon={<LayoutColumnThreeRegular />}
					onClick={cycleFocusLayout}
				/>
			</Tooltip>
		</Toolbar>
	);
}

function CollapsedStrip({ region, onExpand }: { region: CreateRegionId; onExpand: () => void }): JSX.Element {
	const styles = useStyles();
	const Icon = EXPAND_ICONS[region];
	return (
		<div className={styles.strip}>
			<Tooltip content={expandRegionLabel(region)} relationship="label" positioning={region === 'board' ? 'after' : 'before'}>
				<Button appearance="subtle" icon={<Icon />} onClick={onExpand} {...{ [EXPAND_REGION_ATTRIBUTE]: region }} />
			</Tooltip>
			{region === 'generation' ? <CompactGenerationActions /> : null}
			<span className={styles.stripLabel} aria-hidden>
				{CREATE_REGION_LABELS[region]}
			</span>
		</div>
	);
}

export function CreateSection(): JSX.Element {
	const styles = useStyles();
	const widths = useLayoutStore((state) => state.widths);
	const collapsed = useLayoutStore((state) => state.collapsed);
	const setRegionWidth = useLayoutStore((state) => state.setRegionWidth);
	const setRegionCollapsed = useLayoutStore((state) => state.setRegionCollapsed);
	const row = useRef<HTMLDivElement>(null);
	const available = useElementWidth(row);
	const [draft, setDraft] = useState<Draft | null>(null);
	const idPrefix = useId('create-region-');
	const elementId = (region: CreateRegionId) => `${idPrefix}${region}`;
	// Where the focus goes once a collapse or an expansion is drawn (a selector inside the regions row).
	const pendingFocus = useRef<string | null>(null);

	useEffect(() => {
		const selector = pendingFocus.current;
		pendingFocus.current = null;
		if (selector) {
			row.current?.querySelector<HTMLElement>(selector)?.focus();
		}
	}, [collapsed]);

	const layout = { widths, collapsed };
	const drawn = draft ? { widths: { ...widths, [draft.region]: draft.width }, collapsed } : layout;
	const boxes: RegionBoxes | null = available === null ? null : fitRegions(available, drawn);

	const expand = (region: CreateRegionId) => {
		pendingFocus.current = `[id="${elementId(region)}"]`;
		setRegionCollapsed(region, false);
	};
	const collapseFromSplitter = (region: ResizableRegionId) => {
		pendingFocus.current = `[${EXPAND_REGION_ATTRIBUTE}="${region}"]`;
		setRegionCollapsed(region, true);
	};

	const splitter = (region: ResizableRegionId) => {
		if (boxes === null || available === null || !hasSplitter(region, collapsed)) {
			return null;
		}
		const range = regionWidthRange(region, available, layout);
		return (
			<Splitter
				label={resizeRegionLabel(region)}
				controls={elementId(region)}
				value={boxes[region]}
				min={range.min}
				max={range.max}
				controlledSide="after"
				onDraft={(width) => setDraft(width === null ? null : { region, width })}
				onCommit={(width) => setRegionWidth(region, width)}
				onToggleCollapse={() => collapseFromSplitter(region)}
			/>
		);
	};

	return (
		<div className={styles.root}>
			<div className={styles.header} tabIndex={-1} {...{ [F6_REGION_ATTRIBUTE]: 'commands' }}>
				<div className={styles.commandBar}>
					<CreateCommandBar />
				</div>
				<LayoutToolbar />
			</div>
			<div ref={row} className={styles.regions}>
				{CREATE_REGION_IDS.map((region) => {
					const Content = REGION_CONTENT[region];
					const isCollapsed = collapsed[region];
					const width = boxes?.[region] ?? (isCollapsed ? COLLAPSED_REGION_WIDTH : region === 'board' ? undefined : widths[region]);
					return (
						<Fragment key={region}>
							{isResizableRegion(region) ? splitter(region) : null}
							<section
								id={elementId(region)}
								aria-label={CREATE_REGION_LABELS[region]}
								tabIndex={-1}
								data-collapsed={isCollapsed ? 'true' : undefined}
								className={mergeClasses(
									styles.region,
									region === 'board' ? styles.board : styles.divider,
									isCollapsed && styles.collapsed,
									boxes === null && region === 'board' && !isCollapsed && styles.unmeasuredFill,
								)}
								style={width === undefined ? undefined : { width }}
								{...{ [F6_REGION_ATTRIBUTE]: region }}
							>
								{isCollapsed ? <CollapsedStrip region={region} onExpand={() => expand(region)} /> : null}
								<div className={mergeClasses(styles.content, isCollapsed && styles.contentHidden)} hidden={isCollapsed}>
									<Content />
								</div>
							</section>
						</Fragment>
					);
				})}
			</div>
		</div>
	);
}
