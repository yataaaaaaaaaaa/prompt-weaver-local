type SaveDialog = { showSaveDialog(options: object): Promise<{ canceled: boolean; filePath?: string }> };
type TextFiles = { writeFile(path: string, data: string, encoding: 'utf8'): Promise<void> };
type SaveTextFileOptions = {
	title?: string;
	defaultPath?: string | null;
	filters?: { name: string; extensions: string[] }[];
	content?: unknown;
};
declare const saveTextFileModule: {
	saveTextFile(dialog: SaveDialog, files: TextFiles, options?: SaveTextFileOptions): Promise<string | null>;
};
export = saveTextFileModule;
