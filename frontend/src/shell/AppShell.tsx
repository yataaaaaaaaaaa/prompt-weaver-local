// The app shell: the navigation rail on the left and the shown task section, docked (no floating windows). A section
// mounts on its first visit and then stays mounted, hidden while another section is shown (its scroll position and
// ephemeral view state survive; nothing of an unvisited section runs, e.g. no online search at startup). Each section
// is a <main> landmark named after it (src/app/sections.ts); only the shown one is in the accessibility tree.
//
// Keyboard: the shell turns the navigation store's focus requests into DOM focus (src/shell/regionFocus.ts): F6 /
// Shift+F6 move to the next / previous region on screen (the rail, then the shown section's regions, wrapping), Ctrl+F
// to the shown section's search box, and a section shown from the keyboard (Ctrl+1..5) gets the focus on its first
// region. A rail click keeps the focus on the rail.
import { makeStyles, tokens } from '@fluentui/react-components';
import { useEffect, useRef, type RefObject } from 'react';
import { SECTION_IDS, SECTION_LABELS, type SectionId } from '../app/sections';
import { useIsSectionShown, useIsSectionVisited, useNavigationStore, type FocusRequest } from '../stores/navigationStore';
import { NavRail } from './NavRail';
import { cycleRegionFocus, focusFirstRegion, focusSectionSearch } from './regionFocus';
import { SECTION_VIEWS } from './sectionViews';

/** Marks each section's <main> with its id (the shell finds a section's element by it). */
export const SECTION_ATTRIBUTE = 'data-section';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		height: '100%',
		minHeight: 0,
		backgroundColor: tokens.colorNeutralBackground2,
	},
	// No `display` here: the `hidden` attribute of an inactive section must keep its display: none.
	section: {
		flex: 1,
		minWidth: 0,
		minHeight: 0,
		overflow: 'hidden',
	},
});

function SectionHost({ section }: { section: SectionId }): JSX.Element | null {
	const styles = useStyles();
	const shown = useIsSectionShown(section);
	const visited = useIsSectionVisited(section);
	if (!visited) {
		return null;
	}
	const View = SECTION_VIEWS[section].component;
	return (
		<main aria-label={SECTION_LABELS[section]} hidden={!shown} className={styles.section} {...{ [SECTION_ATTRIBUTE]: section }}>
			<View />
		</main>
	);
}

/** The <main> element of a section inside the shell. */
function sectionElement(root: HTMLElement | null, section: SectionId): HTMLElement | null {
	return root?.querySelector<HTMLElement>(`[${SECTION_ATTRIBUTE}="${section}"]`) ?? null;
}

/** Runs `handle` for every request made after the shell mounted (one made before, e.g. a key pressed while booting,
 *  is not replayed), once the render it caused is committed. */
function useNewRequest<T>(request: FocusRequest<T> | null, handle: (value: T) => void): void {
	const atMount = useRef(request);
	const latestHandle = useRef(handle);
	latestHandle.current = handle;
	useEffect(() => {
		if (request && request !== atMount.current) {
			latestHandle.current(request.value);
		}
	}, [request]);
}

/** Turns the navigation store's focus requests into DOM focus once the shell has rendered what they ask for. */
function useFocusRequests(root: RefObject<HTMLElement>): void {
	const regionCycle = useNavigationStore((state) => state.regionCycle);
	const searchFocus = useNavigationStore((state) => state.searchFocus);
	const sectionFocus = useNavigationStore((state) => state.sectionFocus);
	useNewRequest(regionCycle, (direction) => {
		if (root.current) {
			cycleRegionFocus(root.current, document.activeElement, direction);
		}
	});
	useNewRequest(searchFocus, (section) => focusSectionSearch(sectionElement(root.current, section)));
	useNewRequest(sectionFocus, (section) => focusFirstRegion(sectionElement(root.current, section)));
}

export function AppShell(): JSX.Element {
	const styles = useStyles();
	const root = useRef<HTMLDivElement>(null);
	useFocusRequests(root);
	return (
		<div ref={root} className={styles.root} data-app-shell="">
			<NavRail />
			{SECTION_IDS.map((section) => (
				<SectionHost key={section} section={section} />
			))}
		</div>
	);
}
