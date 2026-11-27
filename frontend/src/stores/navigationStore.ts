// Navigation store: single truth holder of which task section is shown (Create, Models, Images, Characters, Story; ids and
// names in src/app/sections.ts), of the sections visited so far (a section view mounts on its first visit and then
// stays mounted, hidden, so its scroll position and focus survive) and of the keyboard focus requests the shell turns
// into DOM focus: F6 / Shift+F6 region cycling, Ctrl+F (focus the shown section's search box) and the focus move of a
// section shown from the keyboard (Ctrl+1..5: the section's first region; a rail click keeps the focus on the rail).
// Not persisted: the app always starts on DEFAULT_SECTION.
//
// Cross-store hand-offs go through here: "Create character" opens the Characters section
// (charactersStore -> showSection('characters')), and success notifications offer `goToSectionAction('create')`.
import { create } from 'zustand';
import { DEFAULT_SECTION, SECTION_LABELS, type CreateRegionId, type SectionId } from '../app/sections';
import { useLayoutStore } from './layoutStore';
import type { NotificationAction } from './notificationsStore';

/** A focus request: the shell moves the DOM focus when its serial changes (a new request for the same thing is a new
 *  value). */
export type FocusRequest<T> = { value: T; serial: number };

export type RegionCycleDirection = 1 | -1;

export type NavigationState = {
	section: SectionId;
	/** Sections shown at least once since startup (their views stay mounted). */
	visited: Readonly<Partial<Record<SectionId, true>>>;
	/** The last F6 (1) / Shift+F6 (-1) press; the shell focuses the next / previous region landmark. */
	regionCycle: FocusRequest<RegionCycleDirection> | null;
	/** The last Ctrl+F press; the shell focuses the shown section's search box (SECTION_SEARCH_ATTRIBUTE). */
	searchFocus: FocusRequest<SectionId> | null;
	/** The last section shown with `{ focus: true }` (Ctrl+1..5, the Electron menu); the shell focuses its first region
	 *  (F6_REGION_ATTRIBUTE). */
	sectionFocus: FocusRequest<SectionId> | null;
};

export type ShowSectionOptions = {
	/** Also move the keyboard focus to the section's first region (keyboard and menu commands), even when the section is
	 *  already shown. Pointer navigation (a rail click) leaves the focus where it is. */
	focus?: boolean;
};

export type NavigationActions = {
	/** Shows a section (and marks it visited). No-op when it is already shown, unless `focus` is asked. */
	showSection: (section: SectionId, options?: ShowSectionOptions) => void;
	/** F6 / Shift+F6: asks the shell to move the focus to the next / previous region. */
	cycleRegion: (direction: RegionCycleDirection) => void;
	/** Ctrl+F: asks the shell to focus the search box of the shown section. In Create that is the prompt board's
	 *  search (CREATE_SEARCH_REGION): a collapsed board is expanded first. */
	focusSearch: () => void;
};

export type NavigationStore = NavigationState & NavigationActions;

const nextSerial = (request: FocusRequest<unknown> | null): number => (request?.serial ?? 0) + 1;

/** The Create region holding the section's search box (the prompt board's search and filter). */
export const CREATE_SEARCH_REGION: CreateRegionId = 'board';

export const useNavigationStore = create<NavigationStore>()((set, get) => ({
	section: DEFAULT_SECTION,
	visited: { [DEFAULT_SECTION]: true },
	regionCycle: null,
	searchFocus: null,
	sectionFocus: null,

	showSection: (section, { focus = false } = {}) => {
		if (get().section !== section) {
			set((state) => ({ section, visited: state.visited[section] ? state.visited : { ...state.visited, [section]: true } }));
		}
		if (focus) {
			set((state) => ({ sectionFocus: { value: section, serial: nextSerial(state.sectionFocus) } }));
		}
	},
	cycleRegion: (direction) => set((state) => ({ regionCycle: { value: direction, serial: nextSerial(state.regionCycle) } })),
	focusSearch: () => {
		if (get().section === 'create') {
			useLayoutStore.getState().setRegionCollapsed(CREATE_SEARCH_REGION, false);
		}
		set((state) => ({ searchFocus: { value: state.section, serial: nextSerial(state.searchFocus) } }));
	},
}));

// ---------------------------------------------------------------------------
// Selectors / hooks / helpers
// ---------------------------------------------------------------------------

export const selectSection = (state: NavigationState): SectionId => state.section;

export function useIsSectionShown(section: SectionId): boolean {
	return useNavigationStore((state) => state.section === section);
}

export function useIsSectionVisited(section: SectionId): boolean {
	return useNavigationStore((state) => state.visited[section] === true);
}

/** The one-click follow-up of a hand-off notification: 'Go to <section>' (e.g. after "Use these LoRAs" in Images). */
export function goToSectionAction(section: SectionId): NotificationAction {
	return {
		label: `Go to ${SECTION_LABELS[section]}`,
		run: () => useNavigationStore.getState().showSection(section),
		section,
	};
}

/** Whether a notification's action is worth offering while `shown` is the shown section: a 'Go to <section>' action is
 *  not while that section is already shown (e.g. a download that completes while the user composes in Create). */
export function isActionApplicable(action: NotificationAction, shown: SectionId): boolean {
	return action.section !== shown;
}

/** The action of a notification to offer now (null when it has none or it only shows the shown section). */
export function useApplicableAction(action: NotificationAction | null): NotificationAction | null {
	const applicable = useNavigationStore((state) => action !== null && isActionApplicable(action, state.section));
	return applicable ? action : null;
}
