// Copy-to-clipboard as a store action: the clipboard side effect (src/services/clipboard.ts) plus the user
// feedback (success notification, or an error notification on failure). Shared by every store that copies text.
import { clipboard } from '../services/clipboard';
import { reportError, useNotificationsStore } from './notificationsStore';

/** Copies `text` (no-op when empty) and notifies "<what> copied to the clipboard." */
export async function copyTextWithFeedback(text: string | null | undefined, what: string): Promise<void> {
	if (!text) {
		return;
	}
	try {
		await clipboard.writeText(text);
		useNotificationsStore.getState().notify('success', `${what} copied to the clipboard.`);
	} catch (error) {
		reportError(error, `Could not copy the ${what.toLowerCase()}`);
	}
}
