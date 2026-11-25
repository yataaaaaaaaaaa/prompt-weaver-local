// Presentational formatting of the model library views (pure; no domain rules).

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const BYTE_STEP = 1024;

/** Human-readable size: whole bytes below 1 KB, else KB/MB/GB (1024-based) with one decimal place ('6.5 GB').
 *  Negative or non-finite values show as '0 B'. */
export function formatBytes(bytes: number): string {
	let scaled = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
	let unit = 0;
	// The next unit is used as soon as the rounded value would reach 1024 ('1024.0 KB' -> '1.0 MB').
	while (unit < BYTE_UNITS.length - 1 && (unit === 0 ? scaled : Number(scaled.toFixed(1))) >= BYTE_STEP) {
		scaled /= BYTE_STEP;
		unit += 1;
	}
	return unit === 0 ? `${Math.round(scaled)} B` : `${scaled.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** Transfer progress: '1.2 GB of 6.9 GB', or only the received size while the total is unknown (0). */
export function formatTransfer(current: number, total: number): string {
	return total > 0 ? `${formatBytes(current)} of ${formatBytes(total)}` : formatBytes(current);
}

const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/** A download count with thousands separators ('48,210 downloads'; '1 download'). */
export function formatDownloads(count: number): string {
	const value = Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
	return `${COUNT_FORMAT.format(value)} ${value === 1 ? 'download' : 'downloads'}`;
}

/** A file system path cut after each separator ('/' or '\'): the views put a line break opportunity (<wbr>) between
 *  the segments, so a long path wraps between folder names instead of inside one. Joined, they are the path. */
export function pathSegments(path: string): string[] {
	return path.split(/(?<=[\\/])/).filter((segment) => segment !== '');
}
