// Shown until the session store reaches 'ready': the app name and a spinner while connecting, a blocking error card
// with Retry (the primary action) when booting failed.
import { Button, makeStyles, Spinner, Title3, tokens } from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import { useSessionStore } from '../stores/sessionStore';
import { CenteredScreen, ErrorCard } from './CenteredScreen';

const useStyles = makeStyles({
	connecting: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalXXL,
	},
	title: {
		margin: 0,
	},
});

export function BootScreen(): JSX.Element {
	const styles = useStyles();
	const phase = useSessionStore((state) => state.phase);
	const bootError = useSessionStore((state) => state.bootError);
	const retry = useSessionStore((state) => state.retry);

	return (
		<CenteredScreen as="main">
			{phase === 'failed' ? (
				<ErrorCard
					title="Prompt Weaver could not start"
					message={bootError ?? 'The backend could not be reached.'}
					actions={
						<Button appearance="primary" icon={<ArrowClockwiseRegular />} onClick={() => void retry()}>
							Retry
						</Button>
					}
				/>
			) : (
				<div role="status" className={styles.connecting}>
					<Title3 as="h1" className={styles.title}>
						Prompt Weaver
					</Title3>
					<Spinner size="large" label="Connecting to the backend…" labelPosition="below" />
				</div>
			)}
		</CenteredScreen>
	);
}
