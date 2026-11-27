import { describe, expect, it } from 'vitest';
import { inlineText, parseInline, parseMarkdown, safeHref } from './markdown';

const text = (value: string) => ({ kind: 'text', text: value });

describe('inline', () => {
	it('reads code, strong, emphasis, links, escapes and line breaks', () => {
		expect(parseInline('Use `rain, night` and **two** *quiet* [docs](https://example.com) a\\*b\nend')).toEqual([
			text('Use '),
			{ kind: 'code', text: 'rain, night' },
			text(' and '),
			{ kind: 'strong', children: [text('two')] },
			text(' '),
			{ kind: 'emphasis', children: [text('quiet')] },
			text(' '),
			{ kind: 'link', href: 'https://example.com', children: [text('docs')] },
			text(' a*b'),
			{ kind: 'break' },
			text('end'),
		]);
		expect(parseInline('__bold__ and _it_ and ~~gone~~')).toEqual([
			{ kind: 'strong', children: [text('bold')] },
			text(' and '),
			{ kind: 'emphasis', children: [text('it')] },
			text(' and '),
			text('gone'),
		]);
	});

	it('keeps snake_case, lone markers and unfinished (streamed) markup as text', () => {
		expect(inlineText(parseInline('extra_tags and negative_tags'))).toBe('extra_tags and negative_tags');
		expect(parseInline('extra_tags and negative_tags')).toEqual([text('extra_tags and negative_tags')]);
		expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
		expect(parseInline('**unfinished')).toEqual([text('**unfinished')]);
		expect(parseInline('`open')).toEqual([text('`open')]);
	});

	it('never keeps HTML or an unsafe link address', () => {
		expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([text('<img src=x onerror=alert(1)>')]);
		expect(parseInline('[click](javascript:alert(1))')).toEqual([text('click'), text(')')]);
		expect(parseInline('[mail](mailto:a@b.c)')).toEqual([{ kind: 'link', href: 'mailto:a@b.c', children: [text('mail')] }]);
		expect(safeHref('https://civitai.com/models/1')).toBe('https://civitai.com/models/1');
		expect(safeHref('data:text/html,hi')).toBeNull();
		expect(safeHref('file:///C:/secret')).toBeNull();
	});
});

describe('blocks', () => {
	it('reads headings, paragraphs (line breaks kept), rules and quotes', () => {
		expect(parseMarkdown('# Plan\nFirst line\nsecond line\n\n---\n> quoted\n> more')).toEqual([
			{ kind: 'heading', level: 1, children: [text('Plan')] },
			{ kind: 'paragraph', children: [text('First line'), { kind: 'break' }, text('second line')] },
			{ kind: 'rule' },
			{ kind: 'quote', children: [{ kind: 'paragraph', children: [text('quoted'), { kind: 'break' }, text('more')] }] },
		]);
		expect(parseMarkdown('##### Deep')[0]).toMatchObject({ kind: 'heading', level: 3 });
	});

	it('reads bullet and numbered lists, nested lists and continuation lines', () => {
		expect(parseMarkdown('- one\n- two\n  more of two\n  - nested\n\n3. three\n4. four')).toEqual([
			{
				kind: 'list',
				ordered: false,
				start: 1,
				items: [
					[{ kind: 'paragraph', children: [text('one')] }],
					[
						{ kind: 'paragraph', children: [text('two'), { kind: 'break' }, text('more of two')] },
						{ kind: 'list', ordered: false, start: 1, items: [[{ kind: 'paragraph', children: [text('nested')] }]] },
					],
				],
			},
			{
				kind: 'list',
				ordered: true,
				start: 3,
				items: [[{ kind: 'paragraph', children: [text('three')] }], [{ kind: 'paragraph', children: [text('four')] }]],
			},
		]);
	});

	it('reads fenced code (an unclosed fence holds the rest) and tables', () => {
		expect(parseMarkdown('```json\n{"a": 1}\n```\nafter')).toEqual([
			{ kind: 'code', language: 'json', text: '{"a": 1}' },
			{ kind: 'paragraph', children: [text('after')] },
		]);
		expect(parseMarkdown('```\nstreaming\nstill')).toEqual([{ kind: 'code', language: '', text: 'streaming\nstill' }]);
		expect(parseMarkdown('| Scene | Seed |\n|---|---:|\n| Arrival | 7 |\n| Storm |')).toEqual([
			{
				kind: 'table',
				header: [[text('Scene')], [text('Seed')]],
				rows: [
					[[text('Arrival')], [text('7')]],
					[[text('Storm')], []],
				],
			},
		]);
	});

	it('normalizes line endings and keeps plain text as one paragraph', () => {
		expect(parseMarkdown('Hello.\r\nBye.')).toEqual([{ kind: 'paragraph', children: [text('Hello.'), { kind: 'break' }, text('Bye.')] }]);
		expect(parseMarkdown('')).toEqual([]);
	});
});
