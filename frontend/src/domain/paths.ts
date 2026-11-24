// File path helpers for paths picked in desktop dialogs (Windows and POSIX). Pure module.

const SEPARATORS = /[/\\]+/;
const DRIVE = /^[A-Za-z]:$/;

/** Last path segment ('D:\\models\\a.safetensors' -> 'a.safetensors'); the input when it has no segment. */
export function basename(path: string): string {
	const parts = path.split(SEPARATORS).filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

/** File name without its last extension ('a.v2.safetensors' -> 'a.v2'). */
export function stripExtension(fileName: string): string {
	return fileName.replace(/\.[^.]+$/, '');
}

/**
 * Parent directory, keeping the path flavour:
 * 'D:\\a\\b.txt' -> 'D:\\a', 'D:\\b.txt' -> 'D:\\', '/home/u/b' -> '/home/u', '/b' -> '/',
 * '\\\\server\\share\\b' -> '\\\\server\\share', 'a/b' -> 'a'. A bare name is returned unchanged.
 */
export function dirname(path: string): string {
	const parts = path.split(SEPARATORS).filter(Boolean);
	if (parts.length === 0) {
		return path;
	}
	const parentParts = parts.slice(0, -1);
	if (DRIVE.test(parts[0])) {
		return parts.length === 1 ? `${parts[0]}\\` : `${parts[0]}\\${parentParts.slice(1).join('\\')}`;
	}
	if (path.startsWith('\\\\')) {
		return `\\\\${parentParts.join('\\')}`;
	}
	if (path.startsWith('/')) {
		return `/${parentParts.join('/')}`;
	}
	if (parentParts.length === 0) {
		return path;
	}
	return parentParts.join(path.includes('\\') ? '\\' : '/');
}
