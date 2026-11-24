// One sub-prompt of a category card: inline-editable text + Skip / Lock toggles + Delete.
// Visual state (all derived by the owning stores): used by the current output (brand), forbidden together with
// the association source (red; purple when a lock is involved), skipped, indirectly disabled (unreachable).
import { Button, makeStyles, mergeClasses, ToggleButton, tokens, Tooltip } from '@fluentui/react-components';
import { Delete20Regular, LockClosed20Regular, LockOpen20Regular, Prohibited20Regular } from '@fluentui/react-icons';
import type { CategoryKey, SubPromptKey } from '../../domain/categories';
import { useCategoriesStore, useSubPrompt, useSubPromptUiState } from '../../stores/categoriesStore';
import { useForbiddenHighlight } from '../../stores/forbiddenRulesStore';
import { useIsSubPromptInCurrentOutput } from '../../stores/outputsStore';
import { InlineEditableText } from './InlineEditableText';

const useStyles = makeStyles({
	row: {
		display: 'flex',
		alignItems: 'flex-start',
		gap: tokens.spacingHorizontalXXS,
		paddingTop: tokens.spacingVerticalXXS,
		paddingBottom: tokens.spacingVerticalXXS,
		paddingLeft: tokens.spacingHorizontalXXS,
		paddingRight: tokens.spacingHorizontalXXS,
		borderRadius: tokens.borderRadiusMedium,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
	},
	text: {
		flex: '1 1 auto',
		minWidth: 0,
	},
	current: {
		border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
		backgroundColor: tokens.colorBrandBackground2,
	},
	forbidden: {
		border: `${tokens.strokeWidthThin} solid ${tokens.colorPaletteRedBorder2}`,
		backgroundColor: tokens.colorPaletteRedBackground2,
	},
	forbiddenLocked: {
		border: `${tokens.strokeWidthThin} solid ${tokens.colorPalettePurpleBorderActive}`,
		backgroundColor: tokens.colorPalettePurpleBackground2,
	},
	indirectlyDisabled: {
		border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`,
		backgroundColor: tokens.colorNeutralBackground3,
	},
	skippedText: {
		color: tokens.colorNeutralForegroundDisabled,
		textDecorationLine: 'line-through',
	},
	indirectlyDisabledText: {
		color: tokens.colorNeutralForeground3,
		fontStyle: 'italic',
	},
});

export type SubPromptRowProps = {
	categoryKey: CategoryKey;
	promptKey: SubPromptKey;
};

export function SubPromptRow({ categoryKey, promptKey }: SubPromptRowProps): JSX.Element | null {
	const styles = useStyles();
	const subPrompt = useSubPrompt(categoryKey, promptKey);
	const uiState = useSubPromptUiState(categoryKey, promptKey);
	const highlight = useForbiddenHighlight(categoryKey, promptKey);
	const inCurrentOutput = useIsSubPromptInCurrentOutput(categoryKey, promptKey);
	const setSubPromptText = useCategoriesStore((state) => state.setSubPromptText);
	const setSubPromptState = useCategoriesStore((state) => state.setSubPromptState);
	const removeSubPrompt = useCategoriesStore((state) => state.removeSubPrompt);

	if (!subPrompt) {
		return null;
	}
	const skipped = subPrompt.state === 'skip';
	const locked = subPrompt.state === 'lock';

	return (
		<div
			className={mergeClasses(
				styles.row,
				inCurrentOutput && styles.current,
				uiState === 'indirectly-disabled' && styles.indirectlyDisabled,
				highlight === 'forbidden' && styles.forbidden,
				highlight === 'forbidden-locked' && styles.forbiddenLocked,
			)}
			data-ui-state={uiState}
			data-highlight={highlight}
			aria-current={inCurrentOutput ? 'true' : undefined}
		>
			<div className={styles.text}>
				<InlineEditableText
					value={subPrompt.text}
					label="Sub-prompt"
					placeholder="Click to edit"
					rows={3}
					displayClassName={mergeClasses(
						uiState === 'skip' && styles.skippedText,
						uiState === 'indirectly-disabled' && styles.indirectlyDisabledText,
					)}
					onCommit={(text) => setSubPromptText(categoryKey, promptKey, text)}
				/>
			</div>
			<Tooltip content={skipped ? 'Unskip sub-prompt' : 'Skip sub-prompt'} relationship="description">
				<ToggleButton
					appearance="subtle"
					size="small"
					icon={<Prohibited20Regular />}
					aria-label="Skip sub-prompt"
					checked={skipped}
					onClick={() => setSubPromptState(categoryKey, promptKey, skipped ? 'normal' : 'skip')}
				/>
			</Tooltip>
			<Tooltip content={locked ? 'Unlock sub-prompt' : 'Lock sub-prompt (always selected)'} relationship="description">
				<ToggleButton
					appearance="subtle"
					size="small"
					icon={locked ? <LockClosed20Regular /> : <LockOpen20Regular />}
					aria-label="Lock sub-prompt"
					checked={locked}
					onClick={() => setSubPromptState(categoryKey, promptKey, locked ? 'normal' : 'lock')}
				/>
			</Tooltip>
			<Tooltip content="Delete sub-prompt" relationship="label">
				<Button
					appearance="subtle"
					size="small"
					icon={<Delete20Regular />}
					aria-label="Delete sub-prompt"
					onClick={() => removeSubPrompt(categoryKey, promptKey)}
				/>
			</Tooltip>
		</div>
	);
}
