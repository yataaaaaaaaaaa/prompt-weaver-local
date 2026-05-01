export type ElectronDirent = {
    name: string;
    isFile: boolean;
    isDirectory: boolean;
};

export type ElectronWatchEvent = {
    eventType: 'rename' | 'change';
    fileName: string;
};

function getDesktopApi() {
    if (typeof window === 'undefined') {
        return null;
    }
    return window.promptWeaverDesktop ?? null;
}

function makeDesktopUnavailableError(): Error {
    return new Error('promptWeaverDesktop is not available. The frontend must run inside the Electron shell.');
}

export function isDesktopApiAvailable(): boolean {
    return getDesktopApi() != null;
}

function normalizePathSegment(part: string): string {
    return part.replace(/\+/g, '/').replace(/^\/+|\/+$/g, '');
}

function fallbackJoinPath(...parts: string[]): string {
    if (parts.length === 0) {
        return '';
    }

    const [firstPart, ...rest] = parts;
    const normalizedFirstPart = firstPart.replace(/\+/g, '/').replace(/\/+$/g, '');
    const normalizedRest = rest
        .map((part) => normalizePathSegment(part))
        .filter((part) => part.length > 0);

    if (normalizedFirstPart.length === 0) {
        return normalizedRest.join('/');
    }

    return [normalizedFirstPart, ...normalizedRest].join('/');
}

function fallbackDirname(filePath: string): string {
    const normalized = filePath.replace(/\+/g, '/').replace(/\/+$/g, '');
    const lastSeparatorIndex = normalized.lastIndexOf('/');
    if (lastSeparatorIndex < 0) {
        return '.';
    }
    if (lastSeparatorIndex === 0) {
        return '/';
    }
    return normalized.slice(0, lastSeparatorIndex);
}

export async function access(filePath: string): Promise<void> {
    const desktop = getDesktopApi();
    if (!desktop) {
        throw makeDesktopUnavailableError();
    }
    await desktop.fsAccess(filePath);
}

export async function mkdir(directoryPath: string): Promise<void> {
    const desktop = getDesktopApi();
    if (!desktop) {
        throw makeDesktopUnavailableError();
    }
    await desktop.fsMkdir(directoryPath);
}

export async function readFileUtf8(filePath: string): Promise<string> {
    const desktop = getDesktopApi();
    if (!desktop) {
        throw makeDesktopUnavailableError();
    }
    return desktop.fsReadFileUtf8(filePath);
}

export async function readFileBase64(filePath: string): Promise<string> {
    const desktop = getDesktopApi();
    if (!desktop) {
        throw makeDesktopUnavailableError();
    }
    return desktop.fsReadFileBase64(filePath);
}

export async function writeFileUtf8(filePath: string, data: string): Promise<void> {
    const desktop = getDesktopApi();
    if (!desktop) {
        throw makeDesktopUnavailableError();
    }
    await desktop.fsWriteFileUtf8(filePath, data);
}

export async function readdir(directoryPath: string): Promise<ElectronDirent[]> {
    const desktop = getDesktopApi();
    if (!desktop) {
        throw makeDesktopUnavailableError();
    }
    return desktop.fsReaddir(directoryPath);
}

export function watchDirectory(directoryPath: string, callback: (event: ElectronWatchEvent) => void): (() => void) | void {
    const desktop = getDesktopApi();
    if (!desktop) {
        return undefined;
    }
    return desktop.watchDirectory(directoryPath, callback);
}

export function joinPath(...parts: string[]): string {
    const desktop = getDesktopApi();
    if (!desktop) {
        return fallbackJoinPath(...parts);
    }
    return desktop.pathJoin(...parts);
}

export function dirname(filePath: string): string {
    const desktop = getDesktopApi();
    if (!desktop) {
        return fallbackDirname(filePath);
    }
    return desktop.pathDirname(filePath);
}
