// "Save as" for text the renderer produced (e.g. a story exported as an HTML page): the native save dialog picks the
// file, then the text is written there (UTF-8). The renderer never writes files itself and the backend never writes
// outside its data dir: only a path the user picked in the dialog is written. Pure helper: Electron's dialog and the
// file system are passed in.

/**
 * @param {{ showSaveDialog(options: object): Promise<{ canceled: boolean; filePath?: string }> }} dialog
 * @param {{ writeFile(path: string, data: string, encoding: 'utf8'): Promise<void> }} files
 * @param {{ title?: string; defaultPath?: string | null; filters?: { name: string; extensions: string[] }[]; content?: unknown }} options
 * @returns {Promise<string | null>} the path written, null when the dialog was cancelled
 */
async function saveTextFile(dialog, files, options = {}) {
	if (typeof options.content !== 'string') {
		throw new TypeError('saveTextFile needs the text to save (content).');
	}
	const result = await dialog.showSaveDialog({
		title: options.title || 'Save file',
		defaultPath: options.defaultPath || undefined,
		filters: options.filters || undefined,
		properties: ['showOverwriteConfirmation', 'createDirectory', 'dontAddToRecent'],
	});
	if (result.canceled || !result.filePath) {
		return null;
	}
	await files.writeFile(result.filePath, options.content, 'utf8');
	return result.filePath;
}

module.exports = { saveTextFile };
