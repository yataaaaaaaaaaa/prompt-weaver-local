// IPC channel names shared by the main process (main.cjs) and the preload bridge (preload.cjs).
module.exports = {
	PICK_DIRECTORY: 'prompt-weaver:pick-directory',
	PICK_FILE: 'prompt-weaver:pick-file',
	PICK_FILES: 'prompt-weaver:pick-files',
	/** Save dialog + write of a text produced by the renderer (saveTextFile.cjs). */
	SAVE_TEXT_FILE: 'prompt-weaver:save-text-file',
	/** Main -> renderer: an app command id from src/app/keymap.json (Electron menu). */
	COMMAND: 'prompt-weaver:command',
};
