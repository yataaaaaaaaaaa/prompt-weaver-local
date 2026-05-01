import { StateStorage } from 'zustand/middleware';
import { access, joinPath, mkdir, readFileUtf8, writeFileUtf8 } from './electronFs';

export const STORE_ROOT_DIRECTORY = 'D:/Anything/storage/prompt-weaver-local-storage/stores';

function normalizeStorePathSegment(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/').replace(/\.json$/i, '');
    const segments = normalized.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? normalized;
}

async function getStoreDirectoryPath(storePath: string): Promise<string> {
    return joinPath(STORE_ROOT_DIRECTORY, normalizeStorePathSegment(storePath));
}

async function getStoreStateFilePath(storePath: string): Promise<string> {
    return joinPath(STORE_ROOT_DIRECTORY, normalizeStorePathSegment(storePath), 'state.json');
}

async function getLegacyFlatFilePath(storePath: string): Promise<string> {
    return joinPath(STORE_ROOT_DIRECTORY, `${normalizeStorePathSegment(storePath)}.json`);
}

export async function resolveStoreRootDirectory(): Promise<string> {
    return STORE_ROOT_DIRECTORY;
}

export async function ensureDirectoryExists(directoryPath: string): Promise<void> {
    await mkdir(directoryPath);
}

export async function resolveStorePath(filePath: string): Promise<string> {
    return getStoreStateFilePath(filePath);
}

export async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch (error) {
        const nodeError = error as { code?: string };
        if (nodeError.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

export async function hasPersistedStoreData(storePath: string): Promise<boolean> {
    const primaryFilePath = await getStoreStateFilePath(storePath);
    if (await pathExists(primaryFilePath)) {
        return true;
    }

    const legacyDirectoryPath = await getStoreDirectoryPath(storePath);
    const legacyFlatFilePath = await getLegacyFlatFilePath(storePath);
    return await pathExists(legacyDirectoryPath) || await pathExists(legacyFlatFilePath);
}

function logStorageError(operation: string, storePath: string, error: unknown): void {
    const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[prompt-weaver][store] ${operation} failed for ${storePath}: ${details}`, error);
}

async function readRawStoreFile(filePath: string): Promise<string | null> {
    try {
        return await readFileUtf8(filePath);
    } catch (error) {
        const nodeError = error as { code?: string };
        if (nodeError.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

function extractLegacyMappedValue(raw: string, name: string): string | null {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const directValue = parsed[name];
    if (typeof directValue === 'string') {
        return directValue;
    }

    const values = Object.values(parsed).filter((value): value is string => typeof value === 'string');
    return values.length === 1 ? values[0] : null;
}

async function readPersistedValue(primaryFilePath: string, legacyFilePath: string, name: string): Promise<string | null> {
    const primaryRaw = await readRawStoreFile(primaryFilePath);
    if (primaryRaw != null) {
        try {
            const parsed = JSON.parse(primaryRaw);
            if (
                parsed != null &&
                typeof parsed === 'object' &&
                'state' in parsed
            ) {
                return primaryRaw;
            }
        } catch {
            return primaryRaw;
        }

        try {
            const mapped = extractLegacyMappedValue(primaryRaw, name);
            if (mapped != null) {
                return mapped;
            }
        } catch {
            return primaryRaw;
        }

        return primaryRaw;
    }

    const legacyRaw = await readRawStoreFile(legacyFilePath);
    if (legacyRaw == null) {
        return null;
    }

    try {
        return extractLegacyMappedValue(legacyRaw, name);
    } catch {
        return legacyRaw;
    }
}

async function ensureStoreFileExists(filePath: string): Promise<void> {
    if (await pathExists(filePath)) {
        return;
    }
    await writeFileUtf8(filePath, 'null');
}

const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite(filePath: string, writeOperation: () => Promise<void>): Promise<void> {
    const previous = writeQueues.get(filePath) ?? Promise.resolve();
    const next = previous
        .catch(() => undefined)
        .then(writeOperation)
        .finally(() => {
            if (writeQueues.get(filePath) === next) {
                writeQueues.delete(filePath);
            }
        });

    writeQueues.set(filePath, next);
    return next;
}

export function createFileBackedStorage(storePath: string): StateStorage<Promise<void>> {
    async function getAbsoluteDirectoryPath(): Promise<string> {
        return getStoreDirectoryPath(storePath);
    }

    async function getAbsolutePrimaryFilePath(): Promise<string> {
        return getStoreStateFilePath(storePath);
    }

    async function getAbsoluteLegacyFilePath(): Promise<string> {
        return getLegacyFlatFilePath(storePath);
    }

    return {
        getItem: async (name: string) => {
            const absoluteDirectoryPath = await getAbsoluteDirectoryPath();
            const absolutePrimaryFilePath = await getAbsolutePrimaryFilePath();
            const absoluteLegacyFilePath = await getAbsoluteLegacyFilePath();

            try {
                await ensureDirectoryExists(absoluteDirectoryPath);
                const persistedValue = await readPersistedValue(absolutePrimaryFilePath, absoluteLegacyFilePath, name);
                if (persistedValue != null) {
                    return persistedValue;
                }

                await ensureStoreFileExists(absolutePrimaryFilePath);
                return null;
            } catch (error) {
                const nodeError = error as { code?: string };
                if (nodeError.code === 'ENOENT') {
                    try {
                        await ensureDirectoryExists(absoluteDirectoryPath);
                        await ensureStoreFileExists(absolutePrimaryFilePath);
                        return null;
                    } catch (createError) {
                        logStorageError('create-default', storePath, createError);
                        return null;
                    }
                }

                logStorageError('read', storePath, error);
                return null;
            }
        },
        setItem: async (_name: string, value: string) => {
            const absoluteDirectoryPath = await getAbsoluteDirectoryPath();
            const absolutePrimaryFilePath = await getAbsolutePrimaryFilePath();

            return enqueueWrite(absolutePrimaryFilePath, async () => {
                try {
                    await ensureDirectoryExists(absoluteDirectoryPath);
                    await writeFileUtf8(absolutePrimaryFilePath, value);
                } catch (error) {
                    logStorageError('write', storePath, error);
                    throw error;
                }
            });
        },
        removeItem: async () => {
            const absoluteDirectoryPath = await getAbsoluteDirectoryPath();
            const absolutePrimaryFilePath = await getAbsolutePrimaryFilePath();

            return enqueueWrite(absolutePrimaryFilePath, async () => {
                try {
                    await ensureDirectoryExists(absoluteDirectoryPath);
                    await writeFileUtf8(absolutePrimaryFilePath, 'null');
                } catch (error) {
                    logStorageError('remove', storePath, error);
                    throw error;
                }
            });
        },
    };
}
