export const OPENAPI_SNAPSHOT_PATH: string;
export const GENERATED_TYPES_PATH: string;
export function normalizeNewlines(text: string): string;
export function generateApiTypes(openapiJsonText: string): Promise<string>;
export function generateFromSnapshot(): Promise<string>;
