// Test doubles of the characters and IP-Adapter stores for view tests (imported by tests only): every action is
// replaced by vi.fn (the views are tested against the store contracts, never the real actions), plus builders of the
// editor state. updateForm, select and setQuery apply their change so the controlled views behave like in the app.
import { vi } from 'vitest';
import { REFERENCE_DEFAULTS } from '../api/defaults.gen';
import type { CharacterForm } from '../domain/characterDrafts';
import { useCharactersStore, type CharacterEditorState } from '../stores/charactersStore';
import { useIpAdapterStore } from '../stores/ipAdapterStore';

export function seedCharacterActions() {
	const actions = {
		load: vi.fn(async () => undefined),
		setActive: vi.fn(async (_characterId: string | null) => undefined),
		toggleActive: vi.fn(async (_characterId: string) => undefined),
		select: vi.fn((characterId: string | null) => useCharactersStore.setState({ selectedId: characterId })),
		setQuery: vi.fn((query: string) => useCharactersStore.setState({ query })),
		startCreate: vi.fn(),
		startCreateFromOutput: vi.fn(),
		startCreateFromImage: vi.fn(async (_imageKey: string) => undefined),
		startEdit: vi.fn((_characterId: string) => undefined),
		updateForm: vi.fn((patch: Partial<CharacterForm>) =>
			useCharactersStore.setState((state) => (state.editor ? { editor: { ...state.editor, form: { ...state.editor.form, ...patch } } } : {})),
		),
		addFormLora: vi.fn((_loraId: string) => undefined),
		removeFormLora: vi.fn((_loraId: string) => undefined),
		setFormLoraWeight: vi.fn((_loraId: string, _weight: number) => undefined),
		removePendingSource: vi.fn((_index: number) => undefined),
		cancelEdit: vi.fn(),
		saveEditor: vi.fn(async () => true),
		remove: vi.fn(async (_characterId: string) => undefined),
		addReferenceFromCurrentOutput: vi.fn(async (_characterId: string) => undefined),
		addReferenceFromFile: vi.fn(async (_characterId: string) => undefined),
		removeReference: vi.fn(async (_characterId: string, _imageId: string) => undefined),
		setThumbnailFromReference: vi.fn(async (_characterId: string, _imageId: string) => undefined),
		setReferenceStrength: vi.fn(async (_characterId: string, _strength: number) => undefined),
	};
	useCharactersStore.setState(actions);
	return actions;
}

export function seedIpAdapterActions() {
	const actions = {
		refresh: vi.fn(async (_options?: { force?: boolean }) => undefined),
		install: vi.fn(async (_variantId: string) => undefined),
		cancelInstall: vi.fn(async (_variantId: string) => undefined),
	};
	useIpAdapterStore.setState(actions);
	return actions;
}

/** An editor form with neutral values (the fields of the test data's Alice). */
export function characterForm(overrides: Partial<CharacterForm> = {}): CharacterForm {
	return {
		name: 'Alice',
		identityText: '1girl, silver hair, blue eyes',
		outfitText: 'school uniform',
		negativeText: 'short hair',
		loras: [],
		seedText: '1234',
		seedLocked: false,
		referenceStrength: REFERENCE_DEFAULTS.strength,
		referenceFocus: REFERENCE_DEFAULTS.focus,
		...overrides,
	};
}

/** The editor open on a new character (characterId null), opened from the Characters section (no return section),
 *  unless overridden. */
export function editorState(overrides: Partial<CharacterEditorState> = {}): CharacterEditorState {
	return {
		session: 1,
		characterId: null,
		returnSection: null,
		form: characterForm(),
		pendingSources: [],
		saving: false,
		error: null,
		...overrides,
	};
}
