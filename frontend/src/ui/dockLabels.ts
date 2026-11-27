// The names of a collapsed dock's strip (src/ui/SectionLayout.tsx). Pure data (no React, no Fluent): the e2e suite
// imports it too.

/** Marks the Expand button of a collapsed dock. */
export const EXPAND_DOCK_ATTRIBUTE = 'data-expand-dock';

/** The accessible name of the Expand button of a collapsed dock. */
export function expandDockLabel(dockLabel: string): string {
	return `Expand ${dockLabel}`;
}
