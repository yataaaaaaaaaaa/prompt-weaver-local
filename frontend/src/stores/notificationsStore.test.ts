import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { DEFAULT_TIMEOUT_MS, describeError, reportError, useNotificationsStore } from './notificationsStore';

const store = () => useNotificationsStore.getState();

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	store().clear();
	vi.useRealTimers();
});

describe('notificationsStore', () => {
	it('adds notifications with ids, titles and intents', () => {
		const first = store().notify('info', 'Hello', { title: 'Greeting' });
		const second = store().notify('warning', 'Careful');
		expect(second).not.toBe(first);
		expect(store().notifications).toEqual([
			{ id: first, intent: 'info', title: 'Greeting', message: 'Hello', action: null },
			{ id: second, intent: 'warning', title: null, message: 'Careful', action: null },
		]);
	});

	it('runs the action of a notification once, then dismisses it', () => {
		const run = vi.fn();
		const id = store().notify('success', 'LoRAs selected', { action: { label: 'Go to Create', run } });
		expect(store().notifications[0].action?.label).toBe('Go to Create');

		store().runAction(id);
		store().runAction(id);

		expect(run).toHaveBeenCalledTimes(1);
		expect(store().notifications).toEqual([]);
	});

	it('repeats an identical message when its action differs', () => {
		const first = store().notify('success', 'Done');
		const second = store().notify('success', 'Done', { action: { label: 'Go to Create', run: () => undefined } });
		expect(second).not.toBe(first);
		expect(store().notifications).toHaveLength(2);
	});

	it('auto-dismisses success and info, keeps errors and warnings until dismissed', () => {
		store().notify('success', 'Saved');
		store().notify('error', 'Broken');
		store().notify('warning', 'Hmm');
		store().notify('info', 'Note', { timeoutMs: 100 });

		vi.advanceTimersByTime(100);
		expect(store().notifications.map((item) => item.message)).toEqual(['Saved', 'Broken', 'Hmm']);

		vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS.success ?? 0);
		expect(store().notifications.map((item) => item.message)).toEqual(['Broken', 'Hmm']);

		vi.advanceTimersByTime(60_000);
		expect(store().notifications).toHaveLength(2);
	});

	it('errors can still opt into a timeout', () => {
		store().notify('error', 'Transient', { timeoutMs: 500 });
		vi.advanceTimersByTime(500);
		expect(store().notifications).toEqual([]);
	});

	it('does not repeat a notification identical to the latest one and restarts its timer', () => {
		const id = store().notify('success', 'Prompt copied');
		vi.advanceTimersByTime(3000);
		expect(store().notify('success', 'Prompt copied')).toBe(id);
		expect(store().notifications).toHaveLength(1);

		vi.advanceTimersByTime(3000);
		expect(store().notifications).toHaveLength(1);
		vi.advanceTimersByTime(1000);
		expect(store().notifications).toEqual([]);
	});

	it('repeats when intent, title or message differ, or when not consecutive', () => {
		store().notify('error', 'Boom', { title: 'Generation failed' });
		store().notify('error', 'Boom', { title: 'Generation failed' });
		store().notify('error', 'Boom');
		store().notify('warning', 'Boom');
		store().notify('error', 'Boom', { title: 'Generation failed' });
		expect(store().notifications).toHaveLength(4);
	});

	it('dismiss cancels the timer, clear removes everything', () => {
		const id = store().notify('info', 'Bye');
		store().dismiss(id);
		expect(store().notifications).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);

		store().notify('info', 'A');
		store().notify('error', 'B');
		store().clear();
		expect(store().notifications).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('reportError / describeError', () => {
	it('reports errors with an optional title', () => {
		reportError(new ApiError('Output not found', 404, null), 'Could not load output');
		reportError('plain text');
		expect(store().notifications).toMatchObject([
			{ intent: 'error', title: 'Could not load output', message: 'Output not found' },
			{ intent: 'error', title: null, message: 'plain text' },
		]);
	});

	it('describes any thrown value as text', () => {
		expect(describeError(new Error('boom'))).toBe('boom');
		expect(describeError(new TypeError(''))).toBe('TypeError');
		expect(describeError({ detail: 'x' })).toBe('{"detail":"x"}');
		expect(describeError(undefined)).toBe('undefined');
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(describeError(circular)).toBe('[object Object]');
	});
});
