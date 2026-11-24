// Flag records of the stores (busy / running / installing ids: Record<id, true>). One owner of their immutable update.

/** `flags` with `key` set or removed (never mutates `flags`). */
export function withFlag(flags: Record<string, true>, key: string, on: boolean): Record<string, true> {
	if (on) {
		return { ...flags, [key]: true };
	}
	const next = { ...flags };
	delete next[key];
	return next;
}
