// Preload bridge: exposes window.promptWeaverDesktop (type: src/services/desktop.ts DesktopBridge).
// Native file dialogs (open, and save for exported text) and menu commands only; all data goes through the backend API.
const { contextBridge, ipcRenderer } = require('electron');

const channels = require('./ipcChannels.cjs');

contextBridge.exposeInMainWorld('promptWeaverDesktop', {
	platform: process.platform,
	pickDirectory: (options) => ipcRenderer.invoke(channels.PICK_DIRECTORY, options),
	pickFile: (options) => ipcRenderer.invoke(channels.PICK_FILE, options),
	pickFiles: (options) => ipcRenderer.invoke(channels.PICK_FILES, options),
	saveTextFile: (options) => ipcRenderer.invoke(channels.SAVE_TEXT_FILE, options),
	onCommand: (callback) => {
		if (typeof callback !== 'function') {
			return () => {};
		}
		const handler = (_event, command) => callback(command);
		ipcRenderer.on(channels.COMMAND, handler);
		return () => ipcRenderer.removeListener(channels.COMMAND, handler);
	},
});
