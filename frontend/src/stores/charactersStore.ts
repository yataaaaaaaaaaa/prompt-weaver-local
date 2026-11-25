// Characters store: single truth holder, in the frontend, of the characters collection (read from and saved to the
// backend, which owns it: /api/characters), of the active character, and of the character editor (its form while
// it is open, including the images a new character will import). Not persisted (the backend persists everything,
// active_id included). Pure logic lives in src/domain/characterDrafts.ts (forms, prefills) and src/domain/characters.ts
// (prompt injection, read by the generation store). Cross-store coordination happens in the actions:
// - "Create character from this output" reads the current output (useOutputsStore record);
// - "Create character" from an image reads the image library (selectImage) and resolves the image's LoRAs with
//   useImageLibraryStore.getState().collectImageLoras (installs included);
// - reference files are picked with the desktop file dialog (src/services/desktop.ts);
// - the editor opens the Characters pane with useWorkspaceStore.getState().revealPane(CHARACTERS_PANE_ID);
// - failures are notified (reportError), successes too when the user cannot see them.
// Rule: never read another store at module top level or in the initial state (stores import each other).
import { useMemo } from 'react';
import { create } from 'zustand';
import { api } from '../api/client';
import type { Character, CharacterImageSource, LoraWeight } from '../api/types';
import {
	characterFormErrors,
	characterFormFromValues,
	characterValuesFromForm,
	characterValuesFromImage,
	characterValuesFromOutput,
	characterValuesOf,
	clampReferenceStrength,
	emptyCharacterValues,
	newCharacterName,
	type CharacterForm,
	type CharacterFormErrors,
	type CharacterValues,
} from '../domain/characterDrafts';
import { CHARACTERS_PANE_ID } from '../domain/characters';
import { addLorasToSelection, withLoraWeight } from '../domain/loraSelection';
import { namedProblemsText } from '../domain/text';
import { desktop } from '../services/desktop';
import { selectImage, useImageLibraryStore } from './imageLibraryStore';
import { withFlag } from './flags';
import { DESKTOP_DIALOGS_UNAVAILABLE, useLibraryStore } from './libraryStore';
import { describeError, reportError, useNotificationsStore, type NotificationsActions } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import type { LoadStatus } from './pagedSearch';
import { useWorkspaceStore } from './workspaceStore';

/** Re-exported for the views and the pane registry (defined in the pure domain module, which Node-side e2e helpers
 *  can import too). */
export { CHARACTERS_PANE_ID };

export type CharacterEditorState = {
	/** The character being edited; null while creating a new one. */
	characterId: string | null;
	form: CharacterForm;
	/** Images imported as reference images when a NEW character is saved (create from an output / an image), in
	 *  order; the first becomes its thumbnail. Always [] when editing a saved character (its images are edited
	 *  directly, see addReferenceFromCurrentOutput / addReferenceFromFile / removeReference). */
	pendingSources: CharacterImageSource[];
	saving: boolean;
	/** Why the last save failed (shown in the editor); null otherwise. */
	error: string | null;
};

export type CharactersState = {
	/** Every character, in the backend's creation order (api.listCharacters). */
	characters: Character[];
	/** The character active for generation (backend CharacterCollection.active_id). */
	activeId: string | null;
	loadStatus: LoadStatus;
	loadError: string | null;
	/** null: the editor is closed. */
	editor: CharacterEditorState | null;
	/** Character ids with a running request (activation, image import / removal, thumbnail, strength, deletion):
	 *  their controls are disabled meanwhile. */
	busyIds: Record<string, true>;
	/** imageKey whose "Create character" is collecting the image's LoRAs (startCreateFromImage); null otherwise. */
	preparingImageKey: string | null;
};

export type CharactersActions = {
	/** api.listCharacters -> characters + activeId (loadStatus 'loading' -> 'ready' | 'failed' + loadError, no
	 *  notification). Called at boot by the session store and by the pane's Retry. Never rejects. */
	load: () => Promise<void>;
	/** api.setActiveCharacter (null deactivates); applies the answered collection. Failures reported. Never rejects. */
	setActive: (characterId: string | null) => Promise<void>;
	/** One click: activates the character, or deactivates it when it is the active one. */
	toggleActive: (characterId: string) => Promise<void>;
	/** Opens the editor on a new character (emptyCharacterValues with a unique default name) and reveals the pane. */
	startCreate: () => void;
	/** Opens the editor on a new character prefilled from the current output (characterValuesFromOutput), its image as
	 *  pending reference ({kind: 'output'}); reveals the pane. A warning when no output is shown. */
	startCreateFromOutput: () => void;
	/** Opens the editor on a new character prefilled from the image library image (characterValuesFromImage with the
	 *  LoRAs of collectImageLoras: missing ones are installed first), the image as pending reference ({kind: 'url',
	 *  url: image.url}); reveals the pane; a warning lists skipped LoRAs. preparingImageKey is set meanwhile (a second
	 *  call while one prepares is ignored). No-op for an unknown image. Never rejects. */
	startCreateFromImage: (imageKey: string) => Promise<void>;
	/** Opens the editor on a saved character (characterValuesOf) and reveals the pane. */
	startEdit: (characterId: string) => void;
	/** Merges a patch into the editor form (no-op when the editor is closed). */
	updateForm: (patch: Partial<CharacterForm>) => void;
	/** Editor LoRAs: adds a library LoRA at the default weight (unknown or present ids ignored), removes one, sets a
	 *  weight (clampLoraWeight). Same helpers as the LoRA selection (src/domain/loraSelection.ts). */
	addFormLora: (loraId: string) => void;
	removeFormLora: (loraId: string) => void;
	setFormLoraWeight: (loraId: string, weight: number) => void;
	/** Drops one pending reference image of a new character. */
	removePendingSource: (index: number) => void;
	/** Closes the editor without saving. */
	cancelEdit: () => void;
	/** Validates (characterFormErrors: nothing is sent while there are errors), then api.createCharacter (with the
	 *  pending sources) or api.updateCharacter; on success the saved character replaces / joins the list, the editor
	 *  closes and resolves true. A failure keeps the editor open with editor.error set and resolves false. Never
	 *  rejects. */
	saveEditor: () => Promise<boolean>;
	/** api.deleteCharacter; the character leaves the list (and activeId when it was active; the editor closes when it
	 *  edits it). Failures reported. Never rejects. */
	remove: (characterId: string) => Promise<void>;
	/** Imports the current output's image as a reference image ({kind: 'output'}). Failures reported. */
	addReferenceFromCurrentOutput: (characterId: string) => Promise<void>;
	/** Desktop file dialog (PNG, JPEG, WebP, BMP), then imports the file ({kind: 'file'}); a warning when dialogs are
	 *  unavailable (browser). Failures reported. */
	addReferenceFromFile: (characterId: string) => Promise<void>;
	removeReference: (characterId: string, imageId: string) => Promise<void>;
	/** The reference image becomes the thumbnail ({kind: 'character_image'}). */
	setThumbnailFromReference: (characterId: string, imageId: string) => Promise<void>;
	/** Saves a new IP-Adapter strength (clamped to REFERENCE_DEFAULTS.min..max) for a saved character
	 *  (api.updateCharacter with its other values unchanged); no-op when unchanged. */
	setReferenceStrength: (characterId: string, strength: number) => Promise<void>;
};

export type CharactersStore = CharactersState & CharactersActions;

/** File dialog filters of reference images (the formats the backend imports). */
const REFERENCE_IMAGE_FILE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }];

/** `characters` with `saved` replacing the character of the same id, or appended. */
function withCharacter(characters: readonly Character[], saved: Character): Character[] {
	const index = characters.findIndex((character) => character.id === saved.id);
	return index < 0 ? [...characters, saved] : characters.map((character, position) => (position === index ? saved : character));
}

export const useCharactersStore = create<CharactersStore>()((set, get) => {
	/** Identifies the latest load (an older answer is ignored). */
	let loadToken = 0;
	/** Identifies the editor session (incremented whenever the editor opens or closes): a save only touches the
	 *  editor it started from. */
	let editorSession = 0;

	const notify: NotificationsActions['notify'] = (...args) => useNotificationsStore.getState().notify(...args);

	const applyCharacter = (saved: Character) => set((state) => ({ characters: withCharacter(state.characters, saved) }));

	const setBusy = (characterId: string, on: boolean) => set((state) => ({ busyIds: withFlag(state.busyIds, characterId, on) }));

	/** Runs a request of one character, once at a time per character (busyIds set meanwhile); failures reported
	 *  under `failureTitle`. Never rejects. */
	const whileBusy = async (characterId: string, failureTitle: string, action: () => Promise<void>): Promise<void> => {
		if (get().busyIds[characterId]) {
			return;
		}
		setBusy(characterId, true);
		try {
			await action();
		} catch (error) {
			reportError(error, failureTitle);
		} finally {
			setBusy(characterId, false);
		}
	};

	/** Imports the image `pickSource` gives (none: nothing happens) into a saved character, which the answer replaces. */
	const addReference = (characterId: string, pickSource: () => Promise<CharacterImageSource | null>) =>
		whileBusy(characterId, 'Could not add the reference image', async () => {
			const source = await pickSource();
			if (source) {
				applyCharacter(await api.addCharacterReferenceImage(characterId, source));
			}
		});

	/** Opens the editor (replacing an open one) on `values` and reveals the Characters pane. */
	const openEditor = (characterId: string | null, values: CharacterValues, pendingSources: CharacterImageSource[]) => {
		editorSession += 1;
		set({ editor: { characterId, form: characterFormFromValues(values), pendingSources, saving: false, error: null } });
		useWorkspaceStore.getState().revealPane(CHARACTERS_PANE_ID);
	};

	const closeEditor = () => {
		editorSession += 1;
		set({ editor: null });
	};

	/** Applies `change` to the open editor (no-op when it is closed or `change` returns the same editor). */
	const patchEditor = (change: (editor: CharacterEditorState) => CharacterEditorState) =>
		set((state) => {
			if (!state.editor) {
				return state;
			}
			const editor = change(state.editor);
			return editor === state.editor ? state : { editor };
		});

	/** Applies `change` to the LoRAs of the editor form (no-op when it returns the same array). */
	const patchFormLoras = (change: (loras: LoraWeight[]) => LoraWeight[]) =>
		patchEditor((editor) => {
			const loras = change(editor.form.loras);
			return loras === editor.form.loras ? editor : { ...editor, form: { ...editor.form, loras } };
		});

	return {
		characters: [],
		activeId: null,
		loadStatus: 'idle',
		loadError: null,
		editor: null,
		busyIds: {},
		preparingImageKey: null,

		load: async () => {
			const token = ++loadToken;
			set({ loadStatus: 'loading', loadError: null });
			try {
				const collection = await api.listCharacters();
				if (token === loadToken) {
					set({ characters: collection.items, activeId: collection.active_id, loadStatus: 'ready' });
				}
			} catch (error) {
				if (token === loadToken) {
					set({ loadStatus: 'failed', loadError: describeError(error) });
				}
			}
		},

		setActive: async (characterId) => {
			const { activeId } = get();
			// The busy character: the one activated, or the active one when deactivating.
			const busyId = characterId ?? activeId;
			if (busyId === null || characterId === activeId) {
				return;
			}
			const failureTitle = characterId === null ? 'Could not deactivate the character' : 'Could not activate the character';
			await whileBusy(busyId, failureTitle, async () => {
				const collection = await api.setActiveCharacter(characterId);
				set({ characters: collection.items, activeId: collection.active_id });
				const active = selectActiveCharacter(get());
				if (active) {
					notify('success', `${active.name} is active for generation.`);
				}
			});
		},

		toggleActive: (characterId) => get().setActive(get().activeId === characterId ? null : characterId),

		startCreate: () => openEditor(null, emptyCharacterValues(newCharacterName(get().characters)), []),

		startCreateFromOutput: () => {
			const { record } = useOutputsStore.getState();
			if (!record) {
				notify('warning', 'There is no output to create a character from: generate or open an output first.');
				return;
			}
			openEditor(null, characterValuesFromOutput(record), [{ kind: 'output', output_id: record.output_id }]);
		},

		startCreateFromImage: async (imageKey) => {
			if (get().preparingImageKey !== null) {
				return;
			}
			const image = selectImage(imageKey)(useImageLibraryStore.getState());
			if (!image) {
				return;
			}
			set({ preparingImageKey: imageKey });
			try {
				const collection = await useImageLibraryStore.getState().collectImageLoras(imageKey);
				if (!collection) {
					return;
				}
				openEditor(null, characterValuesFromImage(image, collection.items), [{ kind: 'url', url: image.url }]);
				if (collection.skipped.length) {
					notify('warning', namedProblemsText(collection.skipped), { title: 'Some LoRAs of this image are not in the character' });
				}
			} catch (error) {
				reportError(error, 'Could not create the character');
			} finally {
				set({ preparingImageKey: null });
			}
		},

		startEdit: (characterId) => {
			const character = selectCharacter(characterId)(get());
			if (character) {
				openEditor(characterId, characterValuesOf(character), []);
			}
		},

		updateForm: (patch) => patchEditor((editor) => ({ ...editor, form: { ...editor.form, ...patch } })),

		addFormLora: (loraId) => patchFormLoras((loras) => addLorasToSelection(loras, [loraId], useLibraryStore.getState())),

		removeFormLora: (loraId) =>
			patchFormLoras((loras) => (loras.some((item) => item.id === loraId) ? loras.filter((item) => item.id !== loraId) : loras)),

		setFormLoraWeight: (loraId, weight) => patchFormLoras((loras) => withLoraWeight(loras, loraId, weight)),

		removePendingSource: (index) =>
			patchEditor((editor) =>
				index >= 0 && index < editor.pendingSources.length
					? { ...editor, pendingSources: editor.pendingSources.filter((_, position) => position !== index) }
					: editor,
			),

		cancelEdit: () => {
			if (get().editor) {
				closeEditor();
			}
		},

		saveEditor: async () => {
			const editor = get().editor;
			if (!editor || editor.saving || Object.keys(characterFormErrors(editor.form)).length > 0) {
				return false;
			}
			const session = editorSession;
			const values = characterValuesFromForm(editor.form);
			patchEditor((current) => ({ ...current, saving: true, error: null }));
			try {
				const saved =
					editor.characterId === null
						? await api.createCharacter({ ...values, reference_sources: editor.pendingSources })
						: await api.updateCharacter(editor.characterId, values);
				applyCharacter(saved);
				if (session === editorSession) {
					closeEditor();
				}
				if (editor.characterId === null) {
					notify('success', `${saved.name} was created.`);
				}
				return true;
			} catch (error) {
				if (session === editorSession) {
					patchEditor((current) => ({ ...current, saving: false, error: describeError(error) }));
				} else {
					// The editor was closed or replaced meanwhile: nothing shows the failure.
					reportError(error, 'Could not save the character');
				}
				return false;
			}
		},

		remove: (characterId) =>
			whileBusy(characterId, 'Could not delete the character', async () => {
				const name = selectCharacter(characterId)(get())?.name ?? 'The character';
				await api.deleteCharacter(characterId);
				if (get().editor?.characterId === characterId) {
					closeEditor();
				}
				set((state) => ({
					characters: state.characters.filter((character) => character.id !== characterId),
					activeId: state.activeId === characterId ? null : state.activeId,
				}));
				notify('success', `${name} was deleted.`);
			}),

		addReferenceFromCurrentOutput: async (characterId) => {
			const outputId = useOutputsStore.getState().currentId;
			if (outputId === null) {
				notify('warning', 'There is no output to use as a reference image: generate or open an output first.');
				return;
			}
			await addReference(characterId, async () => ({ kind: 'output', output_id: outputId }));
		},

		addReferenceFromFile: async (characterId) => {
			if (!desktop.isAvailable()) {
				notify('warning', DESKTOP_DIALOGS_UNAVAILABLE);
				return;
			}
			await addReference(characterId, async () => {
				const path = await desktop.pickFile({ title: 'Add reference image', filters: REFERENCE_IMAGE_FILE_FILTERS });
				return path ? { kind: 'file', path } : null;
			});
		},

		removeReference: (characterId, imageId) =>
			whileBusy(characterId, 'Could not remove the reference image', async () => {
				applyCharacter(await api.removeCharacterReferenceImage(characterId, imageId));
			}),

		setThumbnailFromReference: (characterId, imageId) =>
			whileBusy(characterId, 'Could not change the thumbnail', async () => {
				applyCharacter(await api.setCharacterThumbnail(characterId, { kind: 'character_image', image_id: imageId }));
			}),

		setReferenceStrength: async (characterId, strength) => {
			const character = selectCharacter(characterId)(get());
			const next = clampReferenceStrength(strength);
			if (!character || next === character.reference_strength) {
				return;
			}
			await whileBusy(characterId, 'Could not change the reference strength', async () => {
				applyCharacter(await api.updateCharacter(characterId, { ...characterValuesOf(character), reference_strength: next }));
			});
		},
	};
});

// ---------------------------------------------------------------------------
// Selectors / hooks (views read through these; nothing derived is stored)
// ---------------------------------------------------------------------------

/** The character active for generation (null when none is, or while the collection is not loaded). */
export const selectActiveCharacter = (state: CharactersState): Character | null =>
	state.activeId === null ? null : (state.characters.find((character) => character.id === state.activeId) ?? null);

export const selectCharacter =
	(characterId: string | null) =>
	(state: CharactersState): Character | null =>
		characterId === null ? null : (state.characters.find((character) => character.id === characterId) ?? null);

export const selectIsCharacterBusy =
	(characterId: string) =>
	(state: CharactersState): boolean =>
		state.busyIds[characterId] === true;

/** The reference image the character's thumbnail was made from (thumbnail source {kind: 'character_image'}), when it
 *  is still one of its reference images; null otherwise (no thumbnail, another source, or the image was removed). */
export const selectThumbnailReferenceId =
	(characterId: string | null) =>
	(state: CharactersState): string | null => {
		const character = selectCharacter(characterId)(state);
		const source = character?.thumbnail?.source;
		if (!character || source?.kind !== 'character_image') {
			return null;
		}
		return character.reference_images.some((image) => image.id === source.image_id) ? source.image_id : null;
	};

/** The gallery order: by name (case-insensitive, locale order), then creation order. Memoized on the list. */
export function useSortedCharacters(): Character[] {
	const characters = useCharactersStore((state) => state.characters);
	return useMemo(
		() => [...characters].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
		[characters],
	);
}

const NO_FORM_ERRORS: CharacterFormErrors = {};

/** Problems of the editor form (characterFormErrors); {} when the editor is closed. Memoized on the form. */
export function useCharacterFormErrors(): CharacterFormErrors {
	const form = useCharactersStore((state) => state.editor?.form ?? null);
	return useMemo(() => (form ? characterFormErrors(form) : NO_FORM_ERRORS), [form]);
}
