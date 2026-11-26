// Text for assistive technologies only (e.g. the prompt board's live announcements, the unit of a card's sub-prompt count): kept
// in the accessibility tree and out of the layout.
import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
	hidden: {
		position: 'absolute',
		width: '1px',
		height: '1px',
		margin: '-1px',
		padding: 0,
		overflow: 'hidden',
		clip: 'rect(0, 0, 0, 0)',
		whiteSpace: 'nowrap',
		border: 0,
	},
});

export function useVisuallyHiddenClass(): string {
	return useStyles().hidden;
}
