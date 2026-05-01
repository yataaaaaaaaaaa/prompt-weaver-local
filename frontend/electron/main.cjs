const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

let backendProcess = null;

function makeBackendCommand() {
	if (process.env.PROMPT_WEAVER_BACKEND_COMMAND) {
		return process.env.PROMPT_WEAVER_BACKEND_COMMAND;
	}
	return process.platform === 'win32' ? 'uv.exe' : 'uv';
}

function makeBackendArgs() {
	if (process.env.PROMPT_WEAVER_BACKEND_ARGS) {
		return process.env.PROMPT_WEAVER_BACKEND_ARGS.split(' ').filter(Boolean);
	}
	return ['run', 'python', 'run_backend.py'];
}

function checkBackendHealth() {
	return new Promise((resolve) => {
		const request = http.get('http://127.0.0.1:8000/api/health', { timeout: 500 }, (response) => {
			response.resume();
			resolve(response.statusCode === 200);
		});
		request.on('error', () => resolve(false));
		request.on('timeout', () => {
			request.destroy();
			resolve(false);
		});
	});
}

async function waitForBackendReady(timeoutMs) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (await checkBackendHealth()) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return false;
}

async function startBackend() {
	if (await checkBackendHealth()) {
		return true;
	}

	if (!backendProcess) {
		const backendCwd = path.join(__dirname, '..', '..', 'backend');
		backendProcess = spawn(makeBackendCommand(), makeBackendArgs(), {
			cwd: backendCwd,
			stdio: 'ignore',
			windowsHide: true,
			shell: false,
		});

		backendProcess.on('exit', () => {
			backendProcess = null;
		});
	}

	return waitForBackendReady(15000);
}

function stopBackend() {
	if (backendProcess && !backendProcess.killed) {
		backendProcess.kill();
	}
	backendProcess = null;
}

function sendCommand(command) {
	const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
	if (!window || window.isDestroyed()) {
		return;
	}
	window.webContents.send('prompt-weaver:command', command);
}

function buildMenu() {
	const template = [
		{
			label: 'File',
			submenu: [
				{ role: 'quit', label: process.platform === 'darwin' ? 'Close Prompt Weaver Local' : 'Exit' },
			],
		},
		{
			label: 'Shortcuts',
			submenu: [
				{ label: 'Toggle visibility', accelerator: 'CommandOrControl+H', click: () => sendCommand('toggle-visibility') },
				{ label: 'Reorganize categories', accelerator: 'CommandOrControl+O', click: () => sendCommand('reorganize-categories') },
				{ type: 'separator' },
				{ label: 'Generate', accelerator: 'CommandOrControl+G', click: () => sendCommand('generate') },
				{ label: 'Toggle continuous generation', accelerator: 'CommandOrControl+T', click: () => sendCommand('toggle-continuous-generate') },
				{ label: 'Compute indirectly disabled', accelerator: 'CommandOrControl+D', click: () => sendCommand('compute-indirectly-disabled') },
			],
		},
		{
			label: 'Help',
			submenu: [
				{
					label: 'About Prompt Weaver Local',
					click: () => {
						dialog.showMessageBox({
							type: 'info',
							title: 'About Prompt Weaver Local',
							message: 'Prompt Weaver Local',
							detail: 'Electron + React frontend, FastAPI backend, local image generation workflow.',
						}).catch(() => { });
					},
				},
			],
		},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
	const window = new BrowserWindow({
		width: 1680,
		height: 1020,
		minWidth: 1280,
		minHeight: 820,
		backgroundColor: '#111827',
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			preload: path.join(__dirname, 'preload.cjs'),
		},
	});

	const devServerUrl = process.env.VITE_DEV_SERVER_URL;
	if (devServerUrl) {
		window.loadURL(devServerUrl);
	} else {
		window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
	}
}

ipcMain.handle('prompt-weaver:pick-directory', async (_event, options = {}) => {
	const result = await dialog.showOpenDialog({
		title: options.title || 'Select folder',
		defaultPath: options.defaultPath || undefined,
		properties: ['openDirectory', 'dontAddToRecent'],
	});
	if (result.canceled || !result.filePaths.length) {
		return null;
	}
	return result.filePaths[0];
});

ipcMain.handle('prompt-weaver:pick-file', async (_event, options = {}) => {
	const result = await dialog.showOpenDialog({
		title: options.title || 'Select file',
		defaultPath: options.defaultPath || undefined,
		filters: options.filters || undefined,
		properties: ['openFile', 'dontAddToRecent'],
	});
	if (result.canceled || !result.filePaths.length) {
		return null;
	}
	return result.filePaths[0];
});

ipcMain.handle('prompt-weaver:pick-files', async (_event, options = {}) => {
	const result = await dialog.showOpenDialog({
		title: options.title || 'Select files',
		defaultPath: options.defaultPath || undefined,
		filters: options.filters || undefined,
		properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
	});
	if (result.canceled) {
		return [];
	}
	return result.filePaths;
});

ipcMain.handle('prompt-weaver:get-user-data-path', async () => {
	return app.getPath('userData');
});

app.whenReady().then(async () => {
	await startBackend();
	buildMenu();
	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('before-quit', () => {
	stopBackend();
});

ipcMain.handle('prompt-weaver:fs-access', async (_event, filePath) => {
	await fs.access(filePath);
	return true;
});

ipcMain.handle('prompt-weaver:fs-mkdir', async (_event, directoryPath) => {
	await fs.mkdir(directoryPath, { recursive: true });
	return true;
});

ipcMain.handle('prompt-weaver:fs-read-file-utf8', async (_event, filePath) => {
	return fs.readFile(filePath, 'utf8');
});

ipcMain.handle('prompt-weaver:fs-read-file-base64', async (_event, filePath) => {
	const buffer = await fs.readFile(filePath);
	return buffer.toString('base64');
});

ipcMain.handle('prompt-weaver:fs-write-file-utf8', async (_event, filePath, data) => {
	await fs.writeFile(filePath, data, 'utf8');
	return true;
});

ipcMain.handle('prompt-weaver:fs-readdir', async (_event, directoryPath) => {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true });
	return entries.map((entry) => ({
		name: entry.name,
		isFile: entry.isFile(),
		isDirectory: entry.isDirectory(),
	}));
});

ipcMain.handle('prompt-weaver:path-join', async (_event, ...parts) => {
	return path.join(...parts);
});

ipcMain.handle('prompt-weaver:path-dirname', async (_event, filePath) => {
	return path.dirname(filePath);
});
