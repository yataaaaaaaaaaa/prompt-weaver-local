// Used sub-prompts of the current output + two-click forbidden associations (P = sub-prompt, C = category,
// tag chips = tag). Rows and their flags are derived by the forbidden-rules store (useUsedSelectionRows);
// every click goes to pickAssociationEndpoint, which owns the association rules.
import { Badge, Body1, Button, Caption1, Caption1Strong, makeStyles, mergeClasses, ToggleButton, tokens, Tooltip } from '@fluentui/react-components';
import { Copy20Regular } from '@fluentui/react-icons';
import type { AssociationEndpoint } from '../../domain/forbiddenRules';
import { useForbiddenRulesStore, useUsedSelectionRows, type UsedSelectionRow } from '../../stores/forbiddenRulesStore';
import { useOutputsStore } from '../../stores/outputsStore';
import { PaneContent } from '../../ui/PaneLayout';

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
	rowPromptForbidden: {
		border: `${tokens.strokeWidthThin} solid ${tokens.colorPaletteRedBorder2}`,
	},
	rowCategoryForbidden: {
		border: `${tokens.strokeWidthThin} solid ${tokens.colorPaletteBerryBorder2}`,
	},
	rowPromptSource: {
		border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
		backgroundColor: tokens.colorBrandBackground2,
	},
	rowCategorySource: {
		border: `${tokens.strokeWidthThin} solid ${tokens.colorPalettePurpleBorderActive}`,
		backgroundColor: tokens.colorPalettePurpleBackground2,
	},
	top: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: tokens.spacingHorizontalS,
	},
	category: {
		display: 'flex',
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
	forbiddenPrompt: {
		backgroundColor: tokens.colorPaletteRedBackground2,
		color: tokens.colorPaletteRedForeground2,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorPaletteRedBorder2}`,
	},
	forbiddenCategory: {
		backgroundColor: tokens.colorPaletteBerryBackground2,
		color: tokens.colorPaletteBerryForeground2,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorPaletteBerryBorder2}`,
	},
	forbiddenTag: {
		backgroundColor: tokens.colorPaletteMarigoldBackground2,
		color: tokens.colorPaletteMarigoldForeground2,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorPaletteMarigoldBorder2}`,
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

type ModeButtonProps = {
	letter: string;
	description: string;
	checked: boolean;
	forbidden: boolean;
	forbiddenClassName: string;
	onClick: () => void;
};

/** P / C association toggle: brand when it is the association source, palette colored when forbidden with it. */
function ModeButton({ letter, description, checked, forbidden, forbiddenClassName, onClick }: ModeButtonProps): JSX.Element {
	const styles = useStyles();
	return (
		<Tooltip content={description} relationship="inaccessible">
			<ToggleButton
				className={mergeClasses(styles.modeButton, forbidden && !checked && forbiddenClassName)}
				appearance={checked ? 'primary' : 'outline'}
				shape="circular"
				size="small"
				checked={checked}
				aria-label={`${letter}: ${description.toLowerCase()}`}
				data-forbidden={forbidden ? 'true' : undefined}
				onClick={onClick}
			>
				{letter}
			</ToggleButton>
		</Tooltip>
	);
}

function UsedSelectionRowView({ row }: { row: UsedSelectionRow }): JSX.Element {
	const styles = useStyles();
	const pickAssociationEndpoint = useForbiddenRulesStore((state) => state.pickAssociationEndpoint);
	const copySelectionPrompt = useOutputsStore((state) => state.copySelectionPrompt);

	return (
		<li
			className={mergeClasses(
				styles.row,
				row.isPromptForbidden && styles.rowPromptForbidden,
				row.isCategoryForbidden && styles.rowCategoryForbidden,
				row.isPromptSource && styles.rowPromptSource,
				row.isCategorySource && styles.rowCategorySource,
			)}
			aria-label={`${row.categoryName}: ${row.promptText}`}
		>
			<div className={styles.top}>
				<Caption1Strong className={styles.category}>
					{row.categoryName}
					{row.locked ? (
						<Badge appearance="outline" size="small" color="informative">
							Locked
						</Badge>
					) : null}
				</Caption1Strong>
				<div className={styles.actions}>
					<Tooltip content={row.promptText || 'Empty sub-prompt'} relationship="description">
						<Button
							appearance="subtle"
							size="small"
							icon={<Copy20Regular />}
							aria-label="Copy sub-prompt"
							onClick={() => void copySelectionPrompt(row.index)}
						/>
					</Tooltip>
					<ModeButton
						letter="P"
						description="Sub-prompt association"
						checked={row.isPromptSource}
						forbidden={row.isPromptForbidden}
						forbiddenClassName={styles.forbiddenPrompt}
						onClick={() => pickAssociationEndpoint(row.promptEndpoint)}
					/>
					<ModeButton
						letter="C"
						description="Category association"
						checked={row.isCategorySource}
						forbidden={row.isCategoryForbidden}
						forbiddenClassName={styles.forbiddenCategory}
						onClick={() => pickAssociationEndpoint(row.categoryEndpoint)}
					/>
				</div>
			</div>
			{row.tags.length > 0 ? (
				<div className={styles.tags} role="group" aria-label="Tags">
					{row.tags.map((tag, tagIndex) => (
						<ToggleButton
							key={`${tagIndex}:${tag.tagText}`}
							className={mergeClasses(styles.tag, tag.isForbidden && !tag.isSource && styles.forbiddenTag)}
							appearance={tag.isSource ? 'primary' : 'outline'}
							shape="circular"
							size="small"
							checked={tag.isSource}
							data-forbidden={tag.isForbidden ? 'true' : undefined}
							onClick={() => pickAssociationEndpoint(tag.endpoint)}
						>
							{tag.tagText}
						</ToggleButton>
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
				<ul className={styles.list} aria-label="Used sub-prompts">
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
