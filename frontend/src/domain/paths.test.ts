import { describe, expect, it } from 'vitest';
import { basename, dirname, stripExtension } from './paths';

describe('basename', () => {
	it.each([
		['D:\\Anything\\ComfyUI\\models\\checkpoints\\catponyReal_ilV41.safetensors', 'catponyReal_ilV41.safetensors'],
		['D:/models/loras/Shion.safetensors', 'Shion.safetensors'],
		['/home/user/models/model-dir/', 'model-dir'],
		['file.ckpt', 'file.ckpt'],
		['', ''],
	])('%j -> %j', (path, expected) => {
		expect(basename(path)).toBe(expected);
	});
});

describe('dirname', () => {
	it.each([
		['D:\\Anything\\ComfyUI\\models\\checkpoints\\a.safetensors', 'D:\\Anything\\ComfyUI\\models\\checkpoints'],
		['D:/models/loras/Shion.safetensors', 'D:\\models\\loras'],
		['D:\\a.safetensors', 'D:\\'],
		['/home/user/models/a.safetensors', '/home/user/models'],
		['/a.safetensors', '/'],
		['\\\\server\\share\\a.safetensors', '\\\\server\\share'],
		['models/a.safetensors', 'models'],
		['a.safetensors', 'a.safetensors'],
	])('%j -> %j', (path, expected) => {
		expect(dirname(path)).toBe(expected);
	});
});

describe('stripExtension', () => {
	it('removes the last extension only', () => {
		expect(stripExtension('Shion.safetensors')).toBe('Shion');
		expect(stripExtension('style.v2.safetensors')).toBe('style.v2');
		expect(stripExtension('folder')).toBe('folder');
	});
});
