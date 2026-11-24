// @vitest-environment node
import { webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { describe, expect, it } from 'vitest';
import windowTheme from './windowTheme.cjs';

describe('Electron window background', () => {
	it('is the surface color of the matching Fluent theme (the FluentProvider background)', () => {
		expect(windowTheme.windowBackgroundColor(true)).toBe(webDarkTheme.colorNeutralBackground2);
		expect(windowTheme.windowBackgroundColor(false)).toBe(webLightTheme.colorNeutralBackground2);
	});
});
