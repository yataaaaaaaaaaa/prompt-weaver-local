// Full-height screen centering one message (boot screen, render error).
import { makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
	root: {
		display: 'grid',
		placeItems: 'center',
		height: '100%',
		padding: tokens.spacingHorizontalXXL,
	},
});

export function CenteredScreen({ as: Element = 'div', children }: { as?: 'div' | 'main'; children: ReactNode }): JSX.Element {
	const styles = useStyles();
	return <Element className={styles.root}>{children}</Element>;
}
