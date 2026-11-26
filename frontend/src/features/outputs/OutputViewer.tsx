// The viewer of the Create section (the shell renders it inside the 'Current image' region, src/app/sections.ts), top
// to bottom: the output actions toolbar, the current picture (it takes the room left), the output filmstrip, and the
// output details panel with its Details / Used sub-prompts tabs (layout store `details`). Fills the region's flex
// column; only the filmstrip and the details tab body scroll. Thin composition of views over the outputs store.
import { makeStyles } from '@fluentui/react-components';
import { CurrentOutputImage } from './CurrentOutputImage';
import { Filmstrip } from './Filmstrip';
import { OutputDetailsPanel } from './OutputDetailsPanel';
import { OutputToolbar } from './OutputToolbar';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		flex: 1,
		minHeight: 0,
		minWidth: 0,
		overflow: 'hidden',
	},
});

export function OutputViewer(): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.root}>
			<OutputToolbar />
			<CurrentOutputImage />
			<Filmstrip />
			<OutputDetailsPanel />
		</div>
	);
}
