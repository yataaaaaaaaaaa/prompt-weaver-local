// Shown until the session store reaches 'ready': a spinner while connecting, the error and a Retry
// button when booting failed.
import {
	Button,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	Spinner,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import { useSessionStore } from '../stores/sessionStore';
import { CenteredScreen } from './CenteredScreen';

const useStyles = makeStyles({
	error: {
		width: '100%',
		maxWidth: '720px',
	},
	details: {
		whiteSpace: 'pre-wrap',
		wordBreak: 'break-word',
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
				<MessageBar intent="error" layout="multiline" className={styles.error}>
					<MessageBarBody>
						<MessageBarTitle>Startup error</MessageBarTitle>
						<span className={styles.details}>{bootError ?? 'The backend could not be reached.'}</span>
					</MessageBarBody>
					<MessageBarActions>
						<Button icon={<ArrowClockwiseRegular />} onClick={() => void retry()}>
							Retry
						</Button>
					</MessageBarActions>
				</MessageBar>
			) : (
				<Spinner size="large" label="Connecting to the backend…" labelPosition="below" />
			)}
		</CenteredScreen>
	);
}
