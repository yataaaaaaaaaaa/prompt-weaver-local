// Undo store: stack of undoable app steps (not persisted). The generation and outputs stores push entries;
// undo() reverts them through the owning stores' actions.
import { create } from 'zustand';
import type { SeedSnapshot } from '../domain/seeds';
import { useGenerationSettingsStore } from './generationSettingsStore';
import { reportError } from './notificationsStore';
import { useOutputsStore } from './outputsStore';

export type UndoEntry =
	| {
			/** A generation: undo shows the previous output again and restores the seed settings. */
			type: 'generate';
			previousOutputId: string | null;
			seeds: SeedSnapshot;
	  }
	| {
			/** A deletion: undo restores the output from the app trash and shows it. */
			type: 'delete-output';
			outputId: string;
	  };

export const UNDO_LIMIT = 50;

export type UndoState = {
	entries: UndoEntry[];
};

export type UndoActions = {
	push: (entry: UndoEntry) => void;
	/** Pops and reverts the latest entry (no-op when empty); failures -> reportError and the entry stays.
	 *  Calls are serialized: pressing undo twice reverts two entries. */
	undo: () => Promise<void>;
	clear: () => void;
};

export type UndoStore = UndoState & UndoActions;

async function revert(entry: UndoEntry): Promise<void> {
	switch (entry.type) {
		case 'generate':
			await useOutputsStore.getState().select(entry.previousOutputId);
			useGenerationSettingsStore.getState().applySeedSnapshot(entry.seeds);
			return;
		case 'delete-output':
			await useOutputsStore.getState().restore(entry.outputId);
			return;
	}
}

/** Tail of the serialized undo operations. */
let undoQueue: Promise<void> = Promise.resolve();

export const useUndoStore = create<UndoStore>()((set, get) => {
	const undoLatest = async (): Promise<void> => {
		const entry = get().entries[get().entries.length - 1];
		if (!entry) {
			return;
		}
		try {
			await revert(entry);
		} catch (error) {
			reportError(error, 'Undo failed');
			return;
		}
		// Removed by identity: a generation may have pushed a newer entry meanwhile.
		set((state) => ({ entries: state.entries.filter((item) => item !== entry) }));
	};

	return {
		entries: [],
		push: (entry) => set((state) => ({ entries: [...state.entries, entry].slice(-UNDO_LIMIT) })),
		undo: () => {
			undoQueue = undoQueue.then(undoLatest);
			return undoQueue;
		},
		clear: () => set({ entries: [] }),
	};
});

export const selectCanUndo = (state: UndoState): boolean => state.entries.length > 0;
