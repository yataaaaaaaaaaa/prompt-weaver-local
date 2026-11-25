// A file system path as text that wraps between folder names (a line break opportunity after each separator,
// pathSegments of format.ts) instead of in the middle of one. Inline content: place it inside a text element.
import { Fragment } from 'react';
import { pathSegments } from './format';

export function PathText({ path }: { path: string }): JSX.Element {
	const segments = pathSegments(path);
	return (
		<>
			{segments.map((segment, index) => (
				<Fragment key={index}>
					{segment}
					{index < segments.length - 1 ? <wbr /> : null}
				</Fragment>
			))}
		</>
	);
}
