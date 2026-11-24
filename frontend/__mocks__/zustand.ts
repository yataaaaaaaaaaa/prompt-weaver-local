// Vitest mock of zustand (activated by vi.mock('zustand') in src/test/setup.ts): every store created
// through `create`/`createStore` is reset to its initial state after each test, so store tests never
// leak state into each other. Pattern from the zustand testing guide.
// Rendered trees are unmounted first: this hook is registered after the cleanup of src/test/setup.ts, so it runs
// before it, and a still mounted component would otherwise react to the reset (e.g. an effect re-running a real
// store action whose request then fails in the next test).
import { act, cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import type * as ZustandExportedTypes from 'zustand';

export * from 'zustand';

const { create: actualCreate, createStore: actualCreateStore } =
	await vi.importActual<typeof ZustandExportedTypes>('zustand');

export const storeResetFns = new Set<() => void>();

const createUncurried = <T>(stateCreator: ZustandExportedTypes.StateCreator<T>) => {
	const store = actualCreate(stateCreator);
	const initialState = store.getInitialState();
	storeResetFns.add(() => {
		store.setState(initialState, true);
	});
	return store;
};

export const create = (<T>(stateCreator: ZustandExportedTypes.StateCreator<T>) =>
	typeof stateCreator === 'function' ? createUncurried(stateCreator) : createUncurried) as typeof ZustandExportedTypes.create;

const createStoreUncurried = <T>(stateCreator: ZustandExportedTypes.StateCreator<T>) => {
	const store = actualCreateStore(stateCreator);
	const initialState = store.getInitialState();
	storeResetFns.add(() => {
		store.setState(initialState, true);
	});
	return store;
};

export const createStore = (<T>(stateCreator: ZustandExportedTypes.StateCreator<T>) =>
	typeof stateCreator === 'function' ? createStoreUncurried(stateCreator) : createStoreUncurried) as typeof ZustandExportedTypes.createStore;

afterEach(() => {
	cleanup();
	act(() => {
		storeResetFns.forEach((resetFn) => {
			resetFn();
		});
	});
});
