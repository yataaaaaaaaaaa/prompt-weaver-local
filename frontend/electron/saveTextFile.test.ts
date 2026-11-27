// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import saveTextFileModule from './saveTextFile.cjs';

const { saveTextFile } = saveTextFileModule;

function fakes(result: { canceled: boolean; filePath?: string }) {
	return {
		dialog: { showSaveDialog: vi.fn(async (_options: object) => result) },
		files: { writeFile: vi.fn(async (_path: string, _data: string, _encoding: 'utf8') => undefined) },
	};
}

describe('saveTextFile', () => {
	it('writes the text to the path picked in the save dialog and answers it', async () => {
		const { dialog, files } = fakes({ canceled: false, filePath: 'C:/Users/me/Documents/The storm.html' });

		const saved = await saveTextFile(dialog, files, {
			title: 'Export story',
			defaultPath: 'The storm.html',
			filters: [{ name: 'Web page', extensions: ['html'] }],
			content: '<!DOCTYPE html>',
		});

		expect(saved).toBe('C:/Users/me/Documents/The storm.html');
		expect(dialog.showSaveDialog).toHaveBeenCalledWith({
			title: 'Export story',
			defaultPath: 'The storm.html',
			filters: [{ name: 'Web page', extensions: ['html'] }],
			properties: ['showOverwriteConfirmation', 'createDirectory', 'dontAddToRecent'],
		});
		expect(files.writeFile).toHaveBeenCalledWith('C:/Users/me/Documents/The storm.html', '<!DOCTYPE html>', 'utf8');
	});

	it('writes nothing when the dialog is cancelled', async () => {
		const { dialog, files } = fakes({ canceled: true });

		expect(await saveTextFile(dialog, files, { content: 'x' })).toBeNull();
		expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save file', defaultPath: undefined }));
		expect(files.writeFile).not.toHaveBeenCalled();
	});

	it('refuses to open the dialog without text to save', async () => {
		const { dialog, files } = fakes({ canceled: false, filePath: 'C:/x.html' });

		await expect(saveTextFile(dialog, files, {})).rejects.toThrow(TypeError);
		expect(dialog.showSaveDialog).not.toHaveBeenCalled();
	});
});
