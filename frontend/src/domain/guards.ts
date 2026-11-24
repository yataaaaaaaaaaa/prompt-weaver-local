// Untrusted value guards: the one place that validates values read from persisted store data, legacy
// imports and other unknown input before the domain modules use them. Pure module.

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value when it is a plain object, else an empty record. */
export function recordOr(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

export function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/** The value when it is a finite number, else `fallback`. */
export function finiteNumberOr(value: unknown, fallback: number): number {
	return isFiniteNumber(value) ? value : fallback;
}

/** The value when it is a finite number > 0, else `fallback`. */
export function positiveNumberOr(value: unknown, fallback: number): number {
	return isFiniteNumber(value) && value > 0 ? value : fallback;
}

/** The value when it is a string, else `fallback`. */
export function stringOr<T extends string | null>(value: unknown, fallback: T): string | T {
	return typeof value === 'string' ? value : fallback;
}

/** Number typed by the user ('1.5', ' 2 '); null when empty or not a finite number. */
export function parseNumberText(text: string): number | null {
	const trimmed = text.trim();
	if (!trimmed) {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
