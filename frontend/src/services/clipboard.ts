// Clipboard side effect, called by store actions only (tests spy on clipboard.writeText).
export const clipboard = {
	writeText: (text: string): Promise<void> => navigator.clipboard.writeText(text),
};
