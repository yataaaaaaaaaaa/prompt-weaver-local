// THE labelled list of facts (<dl>: each term, then its value, in two aligned columns; long values wrap): the details of
// an output (the viewer's Details tab), the model folders (Models section), a character's values and the IP-Adapter
// folders (Characters section). Pure view.
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
	list: {
		display: 'grid',
		gridTemplateColumns: 'max-content minmax(0, 1fr)',
		columnGap: tokens.spacingHorizontalL,
		rowGap: tokens.spacingVerticalXS,
		margin: 0,
	},
	row: {
		display: 'contents',
	},
	term: {
		color: tokens.colorNeutralForeground3,
		fontSize: tokens.fontSizeBase200,
		lineHeight: tokens.lineHeightBase300,
	},
	value: {
		margin: 0,
		minWidth: 0,
		fontSize: tokens.fontSizeBase300,
		lineHeight: tokens.lineHeightBase300,
		overflowWrap: 'anywhere',
	},
	smallValue: {
		fontSize: tokens.fontSizeBase200,
		lineHeight: tokens.lineHeightBase200,
	},
	smallTerm: {
		lineHeight: tokens.lineHeightBase200,
	},
});

export type Fact = {
	/** The term (unique in the list). */
	term: string;
	value: ReactNode;
};

export type FactListProps = {
	facts: readonly Fact[];
	/** Accessible name of the list. */
	label: string;
	/** 'small' (caption values) in secondary places such as the folders of a panel; 'medium' by default. */
	size?: 'medium' | 'small';
};

export function FactList({ facts, label, size = 'medium' }: FactListProps): JSX.Element {
	const styles = useStyles();
	const small = size === 'small';
	return (
		<dl className={styles.list} aria-label={label}>
			{facts.map(({ term, value }) => (
				<div key={term} className={styles.row}>
					<dt className={mergeClasses(styles.term, small && styles.smallTerm)}>{term}</dt>
					<dd className={mergeClasses(styles.value, small && styles.smallValue)}>{value}</dd>
				</div>
			))}
		</dl>
	);
}
