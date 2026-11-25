// Component-test helpers (imported by tests only): the classes views get from src/ui/stateStyles.tsx, and whether an
// element carries one. jsdom resolves no tokens, so component tests check the Griffel classes; the e2e suite checks the
// colors the browser computes. Griffel class names are deterministic, so the classes computed here are the ones the
// views apply; mergeClasses replaces a class string's '___' sequence token, so only its atomic classes are compared.
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProviders } from '../app/AppProviders';
import type { ActionIntent } from '../ui/stateColors';
import {
	useActionClasses,
	useStateAccentClasses,
	useStateBadgeClasses,
	useStateFrameClasses,
	useStateSurfaceClasses,
	useStateTextClasses,
} from '../ui/stateStyles';

function Providers({ children }: { children: ReactNode }): JSX.Element {
	return <AppProviders colorScheme="light">{children}</AppProviders>;
}

/** Every class family of src/ui/stateStyles.tsx, as the views get them. */
export function stateClasses() {
	return renderHook(
		() => ({
			surface: useStateSurfaceClasses(),
			text: useStateTextClasses(),
			accent: useStateAccentClasses(),
			badge: useStateBadgeClasses(),
			frame: useStateFrameClasses(),
			actions: useActionClasses(),
		}),
		{ wrapper: Providers },
	).result.current;
}

function atomicClassesOf(className: string): string[] {
	return className.split(/\s+/).filter((token) => token && !token.startsWith('___'));
}

/** The element carries every atomic class of `className` (it was merged last: nothing overrides it). */
export function hasClasses(element: Element, className: string): boolean {
	const tokens = atomicClassesOf(className);
	return tokens.length > 0 && tokens.every((token) => element.classList.contains(token));
}

export type IntentVariant = 'filled' | 'subtle';

/** The action intent class `useActionClasses()[variant][intent]` is on `element`. */
export function hasActionIntent(element: Element, variant: IntentVariant, intent: ActionIntent): boolean {
	return hasClasses(element, stateClasses().actions[variant][intent]);
}
