// Root error boundary: a render crash shows the error with its stack instead of a blank window.
import {
	Button,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	tokens,
} from '@fluentui/react-components';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CenteredScreen } from './CenteredScreen';

const useStyles = makeStyles({
	bar: {
		width: '100%',
		maxWidth: '960px',
	},
	stack: {
		margin: `${tokens.spacingVerticalS} 0 0`,
		maxHeight: '60vh',
		overflow: 'auto',
		whiteSpace: 'pre-wrap',
		wordBreak: 'break-word',
		fontFamily: tokens.fontFamilyMonospace,
		fontSize: tokens.fontSizeBase200,
		lineHeight: tokens.lineHeightBase200,
	},
});

function ErrorView({ error, onClose }: { error: Error; onClose: () => void }): JSX.Element {
	const styles = useStyles();
	return (
		<CenteredScreen>
			<MessageBar intent="error" layout="multiline" className={styles.bar}>
				<MessageBarBody>
					<MessageBarTitle>Frontend render error</MessageBarTitle>
					{error.message}
					<pre className={styles.stack}>{error.stack || error.message}</pre>
				</MessageBarBody>
				<MessageBarActions>
					<Button onClick={onClose}>Close</Button>
				</MessageBarActions>
			</MessageBar>
		</CenteredScreen>
	);
}

type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<{ children?: ReactNode }, ErrorBoundaryState> {
	public state: ErrorBoundaryState = { error: null };

	public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	public componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('Prompt Weaver frontend crashed while rendering.', error, info.componentStack);
	}

	private readonly clearError = (): void => {
		this.setState({ error: null });
	};

	public render(): ReactNode {
		if (this.state.error) {
			return <ErrorView error={this.state.error} onClose={this.clearError} />;
		}
		return this.props.children;
	}
}
