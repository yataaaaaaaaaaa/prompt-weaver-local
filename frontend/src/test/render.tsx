// Component test helper: renders inside the Fluent provider (light theme) like the real app.
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';

function Providers({ children }: { children: ReactNode }) {
	return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

export function renderWithProviders(
	ui: ReactElement,
	options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
	return { user: userEvent.setup(), ...render(ui, { wrapper: Providers, ...options }) };
}
