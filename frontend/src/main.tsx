import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

type RootErrorBoundaryState = {
    error: Error | null;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
    public constructor(props: React.PropsWithChildren) {
        super(props);
        this.state = { error: null };
    }

    public static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
        return { error };
    }

    public componentDidCatch(error: Error): void {
        console.error('Prompt Weaver frontend crashed while rendering.', error);
    }

    private clearError = (): void => {
        this.setState({ error: null });
    };

    public render(): React.ReactNode {
        if (this.state.error) {
            return (
                <div className="loading-screen">
                    <div className="global-error-panel">
                        <div className="global-error-title-row">
                            <h1>Frontend render error</h1>
                            <button type="button" className="global-error-dismiss-button" onClick={this.clearError}>Close</button>
                        </div>
                        <pre>{this.state.error.stack || this.state.error.message}</pre>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <RootErrorBoundary>
        <App />
    </RootErrorBoundary>,
);
