// THE accessible names of the viewer's landmarks and controls (the 'Current image' region of Create): the views render
// them, their component tests and the e2e helpers (frontend/e2e/outputs/outputBrowser.ts) find the elements by them.
// Pure data (no React, no Fluent), so the Node-side e2e suite can import it.
import type { DetailsTab } from '../../domain/layout';

export const VIEWER_LABELS = {
	/** The output actions toolbar. */
	outputActions: 'Output actions',
	/** The toggle button of the details panel. */
	detailsToggle: 'Output details',
	/** The details list of the Details tab. */
	detailsList: 'Output details',
	/** The filmstrip listbox. */
	filmstrip: 'Outputs',
	/** The list of the Used sub-prompts tab (items '<category>: <sub-prompt>'). */
	usedSubPrompts: 'Used sub-prompts',
	/** The filmstrip button shown while an older output is viewed. */
	jumpToLatest: 'Jump to latest',
} as const;

/** The names of the details panel's tabs. */
export const DETAILS_TAB_LABELS: Readonly<Record<DetailsTab, string>> = {
	details: 'Details',
	used: 'Used sub-prompts',
};

/** The accessible name of an output's filmstrip option and of its current picture (alt text): 'Output <id>'. */
export function outputPictureName(outputId: string): string {
	return `Output ${outputId}`;
}
