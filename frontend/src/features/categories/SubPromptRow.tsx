// One sub-prompt of a category window: state icon + inline-editable text + Skip / Lock toggles + Delete.
// Its visual state (forbidden, forbidden by a lock, associated, used by the current output, locked, indirectly
// disabled, skipped) is derived by the forbidden-rules store (useSubPromptVisualState); its colors, text decoration
// and icon come from src/ui/stateStyles.tsx only. Color is never the only cue: the icon, the dashed border, the
// italic / line-through text and the button's accessible description carry it too.
import { Button, makeStyles, mergeClasses, ToggleButton, tokens, Tooltip } from '@fluentui/react-components';
import { DeleteRegular, LockClosedRegular, LockOpenRegular, ProhibitedRegular } from '@fluentui/react-icons';
import type { CategoryKey, SubPromptKey } from '../../domain/categories';
import { useCategoriesStore, useSubPrompt } from '../../stores/categoriesStore';
import { useSubPromptVisualState } from '../../stores/forbiddenRulesStore';
import { useIsSubPromptInCurrentOutput } from '../../stores/outputsStore';
import { STATE_COLORS, type VisualState } from '../../ui/stateColors';
import {
	STATE_ICONS,
	useActionClasses,
	useStateAccentClasses,
	useStateSurfaceClasses,
	useStateTextClasses,
} from '../../ui/stateStyles';
import { InlineEditableText } from './InlineEditableText';

/** States whose icon the row shows before its text; locked and skipped rows already show theirs on the checked
 *  Lock / Skip toggles. */
const ICON_STATES: ReadonlySet<VisualState> = new Set<VisualState>(['forbiddenLocked', 'forbidden', 'associated', 'current', 'indirectlyDisabled']);

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
	// Same height as the text button's first line box, so the icon lines up with the first line of text.
	icon: {
		display: 'flex',
		alignItems: 'center',
		flexShrink: 0,
		height: '28px',
		paddingLeft: tokens.spacingHorizontalXS,
		fontSize: tokens.fontSizeBase400,
	},
	text: {
		flex: '1 1 auto',
		minWidth: 0,
	},
	// The 24 px toggles centered on the 28 px first line of the text button.
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexShrink: 0,
		gap: tokens.spacingHorizontalXXS,
		minHeight: '28px',
	},
});

export type SubPromptRowProps = {
	categoryKey: CategoryKey;
	promptKey: SubPromptKey;
};

export function SubPromptRow({ categoryKey, promptKey }: SubPromptRowProps): JSX.Element | null {
	const styles = useStyles();
	const surface = useStateSurfaceClasses();
	const textClasses = useStateTextClasses();
	const accent = useStateAccentClasses();
	const actions = useActionClasses();
	const subPrompt = useSubPrompt(categoryKey, promptKey);
	const visualState = useSubPromptVisualState(categoryKey, promptKey);
	const inCurrentOutput = useIsSubPromptInCurrentOutput(categoryKey, promptKey);
	const setSubPromptText = useCategoriesStore((state) => state.setSubPromptText);
	const setSubPromptState = useCategoriesStore((state) => state.setSubPromptState);
	const removeSubPrompt = useCategoriesStore((state) => state.removeSubPrompt);

	if (!subPrompt) {
		return null;
	}
	const skipped = subPrompt.state === 'skip';
	const locked = subPrompt.state === 'lock';
	const StateIcon = visualState && ICON_STATES.has(visualState) ? STATE_ICONS[visualState] : null;

	return (
		<div
			className={mergeClasses(styles.row, visualState ? surface[visualState] : undefined)}
			data-visual-state={visualState ?? undefined}
			aria-current={inCurrentOutput ? 'true' : undefined}
		>
			{StateIcon && visualState ? (
				<span className={mergeClasses(styles.icon, accent[visualState])} aria-hidden data-state-icon={visualState}>
					<StateIcon />
				</span>
			) : null}
			<div className={styles.text}>
				<InlineEditableText
					value={subPrompt.text}
					label="Sub-prompt"
					placeholder="Click to edit"
					rows={3}
					displayClassName={visualState ? textClasses[visualState] : undefined}
					description={visualState ? STATE_COLORS[visualState].label : undefined}
					onCommit={(text) => setSubPromptText(categoryKey, promptKey, text)}
				/>
			</div>
			<div className={styles.actions}>
				<Tooltip content={skipped ? 'Unskip sub-prompt' : 'Skip sub-prompt'} relationship="description">
					<ToggleButton
						appearance="subtle"
						size="small"
						className={skipped ? actions.filled.warning : undefined}
						icon={<ProhibitedRegular />}
						aria-label="Skip sub-prompt"
						checked={skipped}
						onClick={() => setSubPromptState(categoryKey, promptKey, skipped ? 'normal' : 'skip')}
					/>
				</Tooltip>
				<Tooltip content={locked ? 'Unlock sub-prompt' : 'Lock sub-prompt (always selected)'} relationship="description">
					<ToggleButton
						appearance="subtle"
						size="small"
						className={locked ? accent.locked : undefined}
						icon={locked ? <LockClosedRegular /> : <LockOpenRegular />}
						aria-label="Lock sub-prompt"
						checked={locked}
						onClick={() => setSubPromptState(categoryKey, promptKey, locked ? 'normal' : 'lock')}
					/>
				</Tooltip>
				<Tooltip content="Delete sub-prompt" relationship="label">
					<Button
						appearance="subtle"
						size="small"
						className={actions.subtle.danger}
						icon={<DeleteRegular />}
						aria-label="Delete sub-prompt"
						onClick={() => removeSubPrompt(categoryKey, promptKey)}
					/>
				</Tooltip>
			</div>
		</div>
	);
}
