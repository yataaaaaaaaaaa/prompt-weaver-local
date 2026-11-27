// Markdown (pure): the subset Codex writes in its answers, parsed into blocks and inline nodes that src/ui/Markdown.tsx
// renders as React elements. Safe by construction: there is no HTML node (a tag in the text stays text), and a link
// keeps only an http(s) or mailto address (any other one renders as its text). Tolerant of streamed, unfinished text:
// an unclosed code fence holds the rest of the text, an unclosed emphasis marker stays literal.
//
// Blocks: paragraphs (single line breaks kept), headings (# to ######, shown at three levels), bullet lists (-, *, +)
// and numbered lists (1. or 1)) with nested lists and continuation lines, fenced code (``` or ~~~, with its language),
// block quotes (>), tables (a header row, a |---| row, then rows) and rules (---, ***, ___).
// Inline: `code`, **strong** / __strong__, *emphasis* / _emphasis_ (underscores only at word boundaries, so
// snake_case stays text), ~~strikethrough~~ (shown as text), [links](https://...), backslash escapes and line breaks.

export type MarkdownInline =
	| { kind: 'text'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'strong'; children: MarkdownInline[] }
	| { kind: 'emphasis'; children: MarkdownInline[] }
	| { kind: 'link'; href: string; children: MarkdownInline[] }
	| { kind: 'break' };

export type MarkdownBlock =
	| { kind: 'paragraph'; children: MarkdownInline[] }
	| { kind: 'heading'; level: 1 | 2 | 3; children: MarkdownInline[] }
	| { kind: 'list'; ordered: boolean; start: number; items: MarkdownBlock[][] }
	| { kind: 'code'; language: string; text: string }
	| { kind: 'quote'; children: MarkdownBlock[] }
	| { kind: 'table'; header: MarkdownInline[][]; rows: MarkdownInline[][][] }
	| { kind: 'rule' };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^( {0,3})([-*+])\s+(.*)$/;
const NUMBERED = /^( {0,3})(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** An address a link may keep (others render as text). */
export function safeHref(href: string): string | null {
	const trimmed = href.trim();
	return /^(https?:\/\/|mailto:)/i.test(trimmed) && !/[\s<>"]/.test(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

function isWordCharacter(character: string | undefined): boolean {
	return character !== undefined && /[\p{L}\p{N}_]/u.test(character);
}

/** The index of the closing `marker` of an emphasis opened before `from` (null: none on this text). */
function closingMarker(text: string, marker: string, from: number): number | null {
	let index = from;
	while (index < text.length) {
		const found = text.indexOf(marker, index);
		if (found < 0) {
			return null;
		}
		const before = text[found - 1];
		const after = text[found + marker.length];
		const single = marker.length === 1;
		const doubled = single && (after === marker || before === marker);
		const closesAtBoundary = marker[0] !== '_' || !isWordCharacter(after);
		if (found > from && before !== ' ' && before !== '\\' && !doubled && closesAtBoundary) {
			return found;
		}
		index = found + marker.length;
	}
	return null;
}

export function parseInline(text: string): MarkdownInline[] {
	const nodes: MarkdownInline[] = [];
	let buffer = '';
	const flush = () => {
		if (buffer) {
			nodes.push({ kind: 'text', text: buffer });
			buffer = '';
		}
	};
	let index = 0;
	while (index < text.length) {
		const character = text[index];
		const next = text[index + 1];
		if (character === '\\' && next !== undefined && /[\\`*_{}[\]()#+\-.!|~>]/.test(next)) {
			buffer += next;
			index += 2;
			continue;
		}
		if (character === '\n') {
			flush();
			nodes.push({ kind: 'break' });
			index += 1;
			continue;
		}
		if (character === '`') {
			const ticks = /^`+/.exec(text.slice(index))![0];
			const end = text.indexOf(ticks, index + ticks.length);
			if (end > index) {
				flush();
				nodes.push({ kind: 'code', text: text.slice(index + ticks.length, end).trim() || text.slice(index + ticks.length, end) });
				index = end + ticks.length;
				continue;
			}
		}
		const pair = text.slice(index, index + 2);
		if ((pair === '**' || pair === '__' || pair === '~~') && text[index + 2] !== undefined && text[index + 2] !== ' ') {
			const leftBoundary = pair !== '__' || !isWordCharacter(text[index - 1]);
			const end = leftBoundary ? closingMarker(text, pair, index + 2) : null;
			if (end !== null) {
				flush();
				const children = parseInline(text.slice(index + 2, end));
				nodes.push(...(pair === '~~' ? children : [{ kind: 'strong' as const, children }]));
				index = end + 2;
				continue;
			}
		}
		if ((character === '*' || character === '_') && next !== undefined && next !== ' ' && next !== character) {
			const leftBoundary = character === '*' || !isWordCharacter(text[index - 1]);
			const end = leftBoundary ? closingMarker(text, character, index + 1) : null;
			if (end !== null) {
				flush();
				nodes.push({ kind: 'emphasis', children: parseInline(text.slice(index + 1, end)) });
				index = end + 1;
				continue;
			}
		}
		if (character === '[') {
			const link = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(text.slice(index));
			if (link) {
				flush();
				const href = safeHref(link[2]);
				const children = parseInline(link[1]);
				nodes.push(...(href ? [{ kind: 'link' as const, href, children }] : children));
				index += link[0].length;
				continue;
			}
		}
		buffer += character;
		index += 1;
	}
	flush();
	return nodes;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function tableCells(line: string): string[] {
	const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
	return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function isBlockStart(line: string, nextLine: string | undefined): boolean {
	return (
		FENCE.test(line) ||
		HEADING.test(line) ||
		RULE.test(line) ||
		BULLET.test(line) ||
		NUMBERED.test(line) ||
		QUOTE.test(line) ||
		(line.includes('|') && nextLine !== undefined && TABLE_DIVIDER.test(nextLine))
	);
}

/** The lines of a list item after its first one: indented lines (and blank lines followed by indented ones),
 *  dedented by the item's content indent. */
function itemContinuation(lines: readonly string[], from: number, indent: number): { lines: string[]; end: number } {
	const body: string[] = [];
	let index = from;
	while (index < lines.length) {
		const line = lines[index];
		if (!line.trim()) {
			const following = lines.slice(index + 1).find((item) => item.trim());
			if (following === undefined || following.length - following.trimStart().length < indent) {
				break;
			}
			body.push('');
			index += 1;
			continue;
		}
		const lineIndent = line.length - line.trimStart().length;
		if (lineIndent >= indent) {
			body.push(line.slice(indent));
		} else if (!isBlockStart(line, lines[index + 1]) && body.length > 0 && body[body.length - 1] !== '') {
			body.push(line.trimStart()); // a lazy continuation of the item's paragraph
		} else {
			break;
		}
		index += 1;
	}
	return { lines: body, end: index };
}

function parseList(lines: readonly string[], from: number): { block: MarkdownBlock; end: number } {
	const first = BULLET.exec(lines[from]) ?? NUMBERED.exec(lines[from])!;
	const ordered = !BULLET.test(lines[from]);
	const pattern = ordered ? NUMBERED : BULLET;
	const items: MarkdownBlock[][] = [];
	let index = from;
	while (index < lines.length) {
		const match = pattern.exec(lines[index]);
		if (!match || match[1].length > first[1].length + 1) {
			break;
		}
		const indent = match[1].length + match[2].length + 1 + (/^\s*/.exec(lines[index].slice(match[1].length + match[2].length + 1))?.[0].length ?? 0);
		const rest = itemContinuation(lines, index + 1, Math.min(indent, match[1].length + 2));
		items.push(parseBlocks([match[3], ...rest.lines]));
		index = rest.end;
		// A blank line between items keeps the list going.
		if (index < lines.length && !lines[index].trim() && index + 1 < lines.length && pattern.test(lines[index + 1])) {
			index += 1;
		}
	}
	return { block: { kind: 'list', ordered, start: ordered ? Number(first[2]) : 1, items }, end: index };
}

function parseBlocks(lines: readonly string[]): MarkdownBlock[] {
	const blocks: MarkdownBlock[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (!line.trim()) {
			index += 1;
			continue;
		}
		const fence = FENCE.exec(line);
		if (fence) {
			const closing = lines.findIndex((item, position) => position > index && item.trim().startsWith(fence[1][0].repeat(fence[1].length)) && !item.trim().slice(fence[1].length).trim());
			const end = closing < 0 ? lines.length : closing;
			blocks.push({ kind: 'code', language: fence[2], text: lines.slice(index + 1, end).join('\n') });
			index = end + 1;
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			blocks.push({ kind: 'heading', level: Math.min(heading[1].length, 3) as 1 | 2 | 3, children: parseInline(heading[2]) });
			index += 1;
			continue;
		}
		if (RULE.test(line)) {
			blocks.push({ kind: 'rule' });
			index += 1;
			continue;
		}
		if (BULLET.test(line) || NUMBERED.test(line)) {
			const { block, end } = parseList(lines, index);
			blocks.push(block);
			index = end;
			continue;
		}
		if (QUOTE.test(line)) {
			const quoted: string[] = [];
			while (index < lines.length && QUOTE.test(lines[index])) {
				quoted.push(QUOTE.exec(lines[index])![1]);
				index += 1;
			}
			blocks.push({ kind: 'quote', children: parseBlocks(quoted) });
			continue;
		}
		if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
			const header = tableCells(line).map(parseInline);
			const rows: MarkdownInline[][][] = [];
			index += 2;
			while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
				const cells = tableCells(lines[index]);
				rows.push(header.map((_cell, column) => parseInline(cells[column] ?? '')));
				index += 1;
			}
			blocks.push({ kind: 'table', header, rows });
			continue;
		}
		const paragraph: string[] = [];
		while (index < lines.length && lines[index].trim() && (paragraph.length === 0 || !isBlockStart(lines[index], lines[index + 1]))) {
			paragraph.push(lines[index].trim());
			index += 1;
		}
		blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) });
	}
	return blocks;
}

/** The blocks of a Markdown text (line endings normalized; tabs count as 4 spaces). */
export function parseMarkdown(text: string): MarkdownBlock[] {
	return parseBlocks(text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
}

/** The plain text of inline nodes (an accessible name, a test). */
export function inlineText(nodes: readonly MarkdownInline[]): string {
	return nodes
		.map((node) => {
			switch (node.kind) {
				case 'text':
				case 'code':
					return node.text;
				case 'break':
					return '\n';
				default:
					return inlineText(node.children);
			}
		})
		.join('');
}
