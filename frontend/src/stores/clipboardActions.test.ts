import { describe, expect, it, vi } from 'vitest';
import { clipboard } from '../services/clipboard';
import { copyTextWithFeedback } from './clipboardActions';
import { useNotificationsStore } from './notificationsStore';

const notifications = () => useNotificationsStore.getState().notifications;

describe('copyTextWithFeedback', () => {
	it('copies and confirms', async () => {
		const writeText = vi.spyOn(clipboard, 'writeText').mockResolvedValue(undefined);

		await copyTextWithFeedback('detailed, sharp', 'Trigger words');

		expect(writeText).toHaveBeenCalledWith('detailed, sharp');
		expect(notifications()).toMatchObject([{ intent: 'success', message: 'Trigger words copied to the clipboard.' }]);
	});

	it('ignores empty text and reports failures', async () => {
		const writeText = vi.spyOn(clipboard, 'writeText').mockRejectedValue(new Error('denied'));

		await copyTextWithFeedback('', 'Prompt');
		expect(writeText).not.toHaveBeenCalled();

		await copyTextWithFeedback('x', 'Prompt');
		expect(notifications()).toMatchObject([{ intent: 'error', title: 'Could not copy the prompt', message: 'denied' }]);
	});
});
