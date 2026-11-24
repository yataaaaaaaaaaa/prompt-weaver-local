// The number a Fluent SpinButton change commits: shared by every numeric SpinButton of the app (generation settings,
// LoRA weights). Range rules stay with the owning store action (e.g. libraryStore.setLoraWeight clamps).
import type { SpinButtonOnChangeData } from '@fluentui/react-components';

/** Steppers (buttons, arrow keys, Home/End) report `value`; typed text is reported as `displayValue` on commit
 *  (Enter/blur). Returns the committed number, or null when there is none (cleared field, unparseable text). */
export function spinButtonValue(data: SpinButtonOnChangeData): number | null {
	const next = data.value ?? (data.displayValue === undefined ? Number.NaN : Number.parseFloat(data.displayValue));
	return next !== null && Number.isFinite(next) ? next : null;
}
