// Electron main process: starts (or reuses) the backend, builds the menu from the shared keymap and
// opens the app window (whose web links open in the user's browser: externalLinks.cjs). The backend URL
// comes from config/appConfig.cjs (single owner, honors the PROMPT_WEAVER_BACKEND_URL override set by the
// launcher).
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { backendUrl } = require('../../config/appConfig.cjs');
const keymap = require('../src/app/keymap.json');
const channels = require('./ipcChannels.cjs');
const { installExternalLinkHandler } = require('./externalLinks.cjs');
const { shortcutMenuItems } = require('./shortcutMenu.cjs');
const { windowBackgroundColor } = require('./windowTheme.cjs');

const BACKEND_HEALTH_URL = `${backendUrl()}/api/health`;
const BACKEND_START_TIMEOUT_MS = 15000;
const BACKEND_POLL_INTERVAL_MS = 250;

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
		const request = http.get(BACKEND_HEALTH_URL, { timeout: 500 }, (response) => {
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
		await new Promise((resolve) => setTimeout(resolve, BACKEND_POLL_INTERVAL_MS));
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

	return waitForBackendReady(BACKEND_START_TIMEOUT_MS);
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
	window.webContents.send(channels.COMMAND, command);
}

function buildMenu() {
	const template = [
		{
			label: 'File',
			submenu: [{ role: 'quit', label: process.platform === 'darwin' ? 'Close Prompt Weaver Local' : 'Exit' }],
		},
		{
			label: 'Shortcuts',
			submenu: shortcutMenuItems(keymap, sendCommand),
		},
		{
			label: 'Help',
			submenu: [
				{
					label: 'About Prompt Weaver Local',
					click: () => {
						dialog
							.showMessageBox({
								type: 'info',
								title: 'About Prompt Weaver Local',
								message: 'Prompt Weaver Local',
								detail: 'Electron + React frontend, FastAPI backend, local image generation workflow.',
							})
							.catch(() => {});
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
		backgroundColor: windowBackgroundColor(nativeTheme.shouldUseDarkColors),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			preload: path.join(__dirname, 'preload.cjs'),
		},
	});
	installExternalLinkHandler(window.webContents, shell);

	const devServerUrl = process.env.VITE_DEV_SERVER_URL;
	if (devServerUrl) {
		window.loadURL(devServerUrl);
	} else {
		window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
	}
}

/** Native open dialog; resolves with the picked paths ([] when cancelled). */
async function pickPaths(options, defaultTitle, properties) {
	const result = await dialog.showOpenDialog({
		title: options.title || defaultTitle,
		defaultPath: options.defaultPath || undefined,
		filters: options.filters || undefined,
		properties: [...properties, 'dontAddToRecent'],
	});
	return result.canceled ? [] : result.filePaths;
}

ipcMain.handle(channels.PICK_DIRECTORY, async (_event, options = {}) => (await pickPaths(options, 'Select folder', ['openDirectory']))[0] ?? null);
ipcMain.handle(channels.PICK_FILE, async (_event, options = {}) => (await pickPaths(options, 'Select file', ['openFile']))[0] ?? null);
ipcMain.handle(channels.PICK_FILES, (_event, options = {}) => pickPaths(options, 'Select files', ['openFile', 'multiSelections']));

nativeTheme.on('updated', () => {
	const color = windowBackgroundColor(nativeTheme.shouldUseDarkColors);
	for (const window of BrowserWindow.getAllWindows()) {
		window.setBackgroundColor(color);
	}
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
