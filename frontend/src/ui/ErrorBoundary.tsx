// Root error boundary: a render crash shows the error with its stack (ErrorCard) instead of a blank window.
import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CenteredScreen, ErrorCard } from './CenteredScreen';

const useStyles = makeStyles({
	stack: {
		margin: 0,
		maxHeight: '50vh',
		overflow: 'auto',
		padding: tokens.spacingHorizontalM,
		borderRadius: tokens.borderRadiusMedium,
		backgroundColor: tokens.colorNeutralBackground3,
		color: tokens.colorNeutralForeground2,
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
			<ErrorCard
				title="Frontend render error"
				message={error.message || error.name}
				wide
				actions={
					<Button appearance="primary" onClick={onClose}>
						Close
					</Button>
				}
			>
				<pre className={styles.stack}>{error.stack || error.message}</pre>
			</ErrorCard>
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
