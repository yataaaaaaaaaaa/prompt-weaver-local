// Markdown text (Codex's answers in the co-writer panel), rendered from the safe parse of src/domain/markdown.ts as
// React elements with Fluent 2 tokens: never HTML from the text (no dangerouslySetInnerHTML), links only to http(s) /
// mailto addresses, opened outside the app. '#' / '##' headings get `headingLevel` (below the panel's own heading),
// '###' and deeper the next one. Code
// blocks and tables scroll horizontally inside themselves, so a long line never widens the panel.
import { Link, makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from '../domain/markdown';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
		overflowWrap: 'anywhere',
	},
	paragraph: {
		margin: 0,
	},
	heading: {
		margin: 0,
		...typographyStyles.body1Strong,
	},
	headingLarge: {
		...typographyStyles.subtitle2,
	},
	list: {
		margin: 0,
		paddingLeft: tokens.spacingHorizontalXL,
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
	},
	item: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		'::marker': {
			color: tokens.colorNeutralForeground3,
		},
	},
	listItem: {
		display: 'list-item',
	},
	inlineCode: {
		fontFamily: tokens.fontFamilyMonospace,
		fontSize: '0.92em',
		padding: `0 ${tokens.spacingHorizontalXXS}`,
		borderRadius: tokens.borderRadiusSmall,
		backgroundColor: tokens.colorNeutralBackground1Selected,
	},
	codeBlock: {
		margin: 0,
		padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
		borderRadius: tokens.borderRadiusMedium,
		backgroundColor: tokens.colorNeutralBackground1,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		fontFamily: tokens.fontFamilyMonospace,
		fontSize: tokens.fontSizeBase200,
		lineHeight: tokens.lineHeightBase200,
		overflowX: 'auto',
		whiteSpace: 'pre',
		overflowWrap: 'normal',
	},
	quote: {
		margin: 0,
		paddingLeft: tokens.spacingHorizontalM,
		borderLeft: `${tokens.strokeWidthThick} solid ${tokens.colorNeutralStroke1}`,
		color: tokens.colorNeutralForeground2,
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
	},
	tableFrame: {
		overflowX: 'auto',
		maxWidth: '100%',
	},
	table: {
		borderCollapse: 'collapse',
		...typographyStyles.caption1,
	},
	cell: {
		textAlign: 'start',
		verticalAlign: 'top',
		padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
	headerCell: {
		fontWeight: tokens.fontWeightSemibold,
	},
	rule: {
		width: '100%',
		margin: 0,
		border: 'none',
		borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
});

type Styles = ReturnType<typeof useStyles>;

function Inline({ nodes, styles }: { nodes: readonly MarkdownInline[]; styles: Styles }): JSX.Element {
	return (
		<>
			{nodes.map((node, index) => {
				switch (node.kind) {
					case 'text':
						return <Fragment key={index}>{node.text}</Fragment>;
					case 'break':
						return <br key={index} />;
					case 'code':
						return (
							<code key={index} className={styles.inlineCode}>
								{node.text}
							</code>
						);
					case 'strong':
						return (
							<strong key={index}>
								<Inline nodes={node.children} styles={styles} />
							</strong>
						);
					case 'emphasis':
						return (
							<em key={index}>
								<Inline nodes={node.children} styles={styles} />
							</em>
						);
					case 'link':
						return (
							<Link key={index} inline href={node.href} target="_blank" rel="noreferrer noopener">
								<Inline nodes={node.children} styles={styles} />
							</Link>
						);
				}
			})}
		</>
	);
}

const HEADINGS = ['h3', 'h4', 'h5', 'h6'] as const;

function Block({ block, styles, headingLevel }: { block: MarkdownBlock; styles: Styles; headingLevel: number }): ReactNode {
	switch (block.kind) {
		case 'paragraph':
			return (
				<p className={styles.paragraph}>
					<Inline nodes={block.children} styles={styles} />
				</p>
			);
		case 'heading': {
			// '#' and '##' are the answer's top headings, '###' and deeper the next level.
			const Tag = HEADINGS[Math.min(Math.max(headingLevel - 3, 0) + Math.max(block.level - 2, 0), HEADINGS.length - 1)];
			return (
				<Tag className={mergeClasses(styles.heading, block.level === 1 && styles.headingLarge)}>
					<Inline nodes={block.children} styles={styles} />
				</Tag>
			);
		}
		case 'list': {
			const items = block.items.map((item, index) => (
				<li key={index} className={mergeClasses(styles.listItem)}>
					<span className={styles.item}>
						<Blocks blocks={item} styles={styles} headingLevel={headingLevel} />
					</span>
				</li>
			));
			return block.ordered ? (
				<ol className={styles.list} start={block.start}>
					{items}
				</ol>
			) : (
				<ul className={styles.list}>{items}</ul>
			);
		}
		case 'code':
			return (
				<pre className={styles.codeBlock} tabIndex={0} aria-label={block.language ? `Code (${block.language})` : 'Code'}>
					<code>{block.text}</code>
				</pre>
			);
		case 'quote':
			return (
				<blockquote className={styles.quote}>
					<Blocks blocks={block.children} styles={styles} headingLevel={headingLevel} />
				</blockquote>
			);
		case 'table':
			return (
				<div className={styles.tableFrame}>
					<table className={styles.table}>
						<thead>
							<tr>
								{block.header.map((cell, index) => (
									<th key={index} scope="col" className={mergeClasses(styles.cell, styles.headerCell)}>
										<Inline nodes={cell} styles={styles} />
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{block.rows.map((row, rowIndex) => (
								<tr key={rowIndex}>
									{row.map((cell, index) => (
										<td key={index} className={styles.cell}>
											<Inline nodes={cell} styles={styles} />
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		case 'rule':
			return <hr className={styles.rule} />;
	}
}

function Blocks({ blocks, styles, headingLevel }: { blocks: readonly MarkdownBlock[]; styles: Styles; headingLevel: number }): JSX.Element {
	return (
		<>
			{blocks.map((block, index) => (
				<Block key={index} block={block} styles={styles} headingLevel={headingLevel} />
			))}
		</>
	);
}

export type MarkdownProps = {
	text: string;
	/** The HTML level of a '#' heading (3: below the panel's h2). */
	headingLevel?: number;
	className?: string;
};

export function Markdown({ text, headingLevel = 3, className }: MarkdownProps): JSX.Element {
	const styles = useStyles();
	const blocks = useMemo(() => parseMarkdown(text), [text]);
	return (
		<div className={mergeClasses(styles.root, className)}>
			<Blocks blocks={blocks} styles={styles} headingLevel={headingLevel} />
		</div>
	);
}
