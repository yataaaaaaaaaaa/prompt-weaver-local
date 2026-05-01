const { contextBridge, ipcRenderer } = require('electron');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

contextBridge.exposeInMainWorld('promptWeaverDesktop', {
	platform: process.platform,
	pickDirectory: (options) => ipcRenderer.invoke('prompt-weaver:pick-directory', options),
	pickFile: (options) => ipcRenderer.invoke('prompt-weaver:pick-file', options),
	pickFiles: (options) => ipcRenderer.invoke('prompt-weaver:pick-files', options),
	getUserDataPath: () => ipcRenderer.invoke('prompt-weaver:get-user-data-path'),
	fsAccess: async (filePath) => {
		await fsPromises.access(filePath);
		return true;
	},
	fsMkdir: async (directoryPath) => {
		await fsPromises.mkdir(directoryPath, { recursive: true });
		return true;
	},
	fsReadFileUtf8: (filePath) => fsPromises.readFile(filePath, 'utf8'),
	fsReadFileBase64: async (filePath) => {
		const buffer = await fsPromises.readFile(filePath);
		return buffer.toString('base64');
	},
	fsWriteFileUtf8: async (filePath, data) => {
		await fsPromises.writeFile(filePath, data, 'utf8');
		return true;
	},
	fsReaddir: async (directoryPath) => {
		const entries = await fsPromises.readdir(directoryPath, { withFileTypes: true });
		return entries.map((entry) => ({
			name: entry.name,
			isFile: entry.isFile(),
			isDirectory: entry.isDirectory(),
		}));
	},
	watchDirectory: (directoryPath, callback) => {
		if (typeof callback !== 'function') {
			return () => { };
		}

		const watcher = fs.watch(directoryPath, { persistent: false }, (eventType, fileName) => {
			callback({
				eventType,
				fileName: typeof fileName === 'string' ? fileName : fileName?.toString?.() ?? '',
			});
		});

		watcher.on('error', (error) => {
			console.error('[prompt-weaver] directory watch failed', error);
		});

		return () => watcher.close();
	},
	pathJoin: (...parts) => path.join(...parts),
	pathDirname: (filePath) => path.dirname(filePath),
	onCommand: (callback) => {
		if (typeof callback !== 'function') {
			return () => { };
		}
		const handler = (_event, command) => callback(command);
		ipcRenderer.on('prompt-weaver:command', handler);
		return () => ipcRenderer.removeListener('prompt-weaver:command', handler);
	},
});
