// Used sub-prompts of the current output + two-click forbidden associations (P = sub-prompt, C = category,
// tag chips = tag). Rows, their flags and their visual states are derived by the forbidden-rules store
// (useUsedSelectionRows): the association source is 'associated' (green), an endpoint a rule forbids with it is
// 'forbidden' (red) or 'forbiddenLocked' (purple). Colors and icons come from src/ui/stateStyles.tsx only; every
// click goes to pickAssociationEndpoint, which owns the association rules.
import { Badge, Body1, Button, Caption1, Caption1Strong, makeStyles, mergeClasses, ToggleButton, tokens, Tooltip } from '@fluentui/react-components';
import { CopyRegular } from '@fluentui/react-icons';
import type { AssociationEndpoint } from '../../domain/forbiddenRules';
import { useForbiddenRulesStore, useUsedSelectionRows, type UsedSelectionRow } from '../../stores/forbiddenRulesStore';
import { useOutputsStore } from '../../stores/outputsStore';
import { PaneContent } from '../../ui/PaneLayout';
import { STATE_COLORS, type VisualState } from '../../ui/stateColors';
import { STATE_ICONS, useStateBadgeClasses, useStateSurfaceClasses } from '../../ui/stateStyles';
import { VIEWER_LABELS } from '../outputs/viewerLabels';

const useStyles = makeStyles({
	intro: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		color: tokens.colorNeutralForeground3,
	},
	hint: {
		color: tokens.colorNeutralForeground2,
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	row: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		paddingLeft: tokens.spacingHorizontalM,
		paddingRight: tokens.spacingHorizontalM,
		borderRadius: tokens.borderRadiusLarge,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground2,
	},
	top: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: tokens.spacingHorizontalS,
	},
	category: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXS,
		minWidth: 0,
		color: tokens.colorNeutralForeground2,
		overflowWrap: 'anywhere',
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXS,
		flexShrink: 0,
	},
	modeButton: {
		minWidth: '32px',
	},
	tags: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXS,
	},
	tag: {
		minWidth: 0,
		fontWeight: tokens.fontWeightRegular,
	},
});

function describeSource(source: AssociationEndpoint): string {
	if (source.mode === 'prompt') {
		return 'sub-prompt';
	}
	if (source.mode === 'category') {
		return 'category';
	}
	return `tag '${source.tagText ?? ''}'`;
}

type EndpointButtonProps = {
	/** Visible text (P, C or the tag). */
	children: string;
	/** Accessible name (defaults to the visible text). */
	ariaLabel?: string;
	/** Visual tooltip (P / C: what the letter means; the accessible name already says it). */
	tooltip?: string;
	className: string;
	isSource: boolean;
	state: VisualState | null;
	onClick: () => void;
};

/** P / C / tag toggle: pressed when it is the association source; its state shows by the surface color, the state
 *  icon and the accessible description. */
function EndpointButton({ children, ariaLabel, tooltip, className, isSource, state, onClick }: EndpointButtonProps): JSX.Element {
	const surface = useStateSurfaceClasses();
	const StateIcon = state ? STATE_ICONS[state] : null;
	const button = (
		<ToggleButton
			className={mergeClasses(className, state ? surface[state] : undefined)}
			appearance="outline"
			shape="circular"
			size="small"
			checked={isSource}
			icon={StateIcon ? <StateIcon /> : undefined}
			aria-label={ariaLabel}
			aria-description={state ? STATE_COLORS[state].label : undefined}
			data-visual-state={state ?? undefined}
			onClick={onClick}
		>
			{children}
		</ToggleButton>
	);
	return tooltip ? (
		<Tooltip content={tooltip} relationship="inaccessible">
			{button}
		</Tooltip>
	) : (
		button
	);
}

function UsedSelectionRowView({ row }: { row: UsedSelectionRow }): JSX.Element {
	const styles = useStyles();
	const surface = useStateSurfaceClasses();
	const badges = useStateBadgeClasses();
	const pickAssociationEndpoint = useForbiddenRulesStore((state) => state.pickAssociationEndpoint);
	const copySelectionPrompt = useOutputsStore((state) => state.copySelectionPrompt);
	const LockedIcon = STATE_ICONS.locked;

	return (
		<li
			className={mergeClasses(styles.row, row.state ? surface[row.state] : undefined)}
			aria-label={`${row.categoryName}: ${row.promptText}`}
			data-visual-state={row.state ?? undefined}
		>
			<div className={styles.top}>
				<Caption1Strong className={styles.category}>
					{row.categoryName}
					{row.locked ? (
						<Badge appearance="outline" size="small" className={badges.locked} icon={<LockedIcon />}>
							Locked
						</Badge>
					) : null}
				</Caption1Strong>
				<div className={styles.actions}>
					<Tooltip content={row.promptText || 'Empty sub-prompt'} relationship="description">
						<Button
							appearance="subtle"
							size="small"
							icon={<CopyRegular />}
							aria-label="Copy sub-prompt"
							onClick={() => void copySelectionPrompt(row.index)}
						/>
					</Tooltip>
					<EndpointButton
						className={styles.modeButton}
						ariaLabel="P: sub-prompt association"
						tooltip="Sub-prompt association"
						isSource={row.isPromptSource}
						state={row.promptState}
						onClick={() => pickAssociationEndpoint(row.promptEndpoint)}
					>
						P
					</EndpointButton>
					<EndpointButton
						className={styles.modeButton}
						ariaLabel="C: category association"
						tooltip="Category association"
						isSource={row.isCategorySource}
						state={row.categoryState}
						onClick={() => pickAssociationEndpoint(row.categoryEndpoint)}
					>
						C
					</EndpointButton>
				</div>
			</div>
			{row.tags.length > 0 ? (
				<div className={styles.tags} role="group" aria-label="Tags">
					{row.tags.map((tag, tagIndex) => (
						<EndpointButton
							key={`${tagIndex}:${tag.tagText}`}
							className={styles.tag}
							isSource={tag.isSource}
							state={tag.state}
							onClick={() => pickAssociationEndpoint(tag.endpoint)}
						>
							{tag.tagText}
						</EndpointButton>
					))}
				</div>
			) : null}
		</li>
	);
}

export function UsedSelectionsPane(): JSX.Element {
	const styles = useStyles();
	const rows = useUsedSelectionRows();
	const source = useForbiddenRulesStore((state) => state.associationSource);
	const hint = source
		? `Source selected: ${describeSource(source)}. Choose P, C, or a tag on another row to create or disable the association.`
		: 'Pick P, C, or a tag on a row to select the source association target.';

	return (
		<PaneContent>
			<div className={styles.intro}>
				<Caption1>P = sub-prompt association. C = category association. Click a tag chip for tag association.</Caption1>
				<Caption1 className={styles.hint} role="status">
					{hint}
				</Caption1>
			</div>
			{rows.length > 0 ? (
				<ul className={styles.list} aria-label={VIEWER_LABELS.usedSubPrompts}>
					{rows.map((row) => (
						<UsedSelectionRowView key={`${row.index}:${row.categoryName}:${row.promptText}`} row={row} />
					))}
				</ul>
			) : (
				<Body1 className={styles.intro}>No selected sub-prompts for the current image.</Body1>
			)}
		</PaneContent>
	);
}
