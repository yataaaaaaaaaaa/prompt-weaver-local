// Root providers: Fluent 2 theme (following the OS color scheme), document-level static styles and the
// root error boundary. Every view renders inside this.
import { FluentProvider, makeStaticStyles, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { useAppTheme } from './theme';

const useDocumentStyles = makeStaticStyles({
	'html, body, #root': {
		margin: 0,
		height: '100%',
		overflow: 'hidden',
	},
	'*, *::before, *::after': {
		boxSizing: 'border-box',
	},
});

const useStyles = makeStyles({
	root: {
		height: '100%',
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground2,
		color: tokens.colorNeutralForeground1,
		fontFamily: tokens.fontFamilyBase,
	},
});

export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
	useDocumentStyles();
	const styles = useStyles();
	const theme = useAppTheme();
	return (
		<FluentProvider theme={theme} className={styles.root}>
			<ErrorBoundary>{children}</ErrorBoundary>
		</FluentProvider>
	);
}
