// What the co-writer panel shows while Codex cannot be used: looking for it, not found (where it looked, a path field),
// not signed in (sign in through the OpenAI Codex app), cannot start, or the backend not answering; each with Retry.
// Thin view over the co-writer store.
import { Button, Field, Input, makeStyles, Spinner, tokens, typographyStyles } from '@fluentui/react-components';
import { ArrowClockwiseRegular, PersonLockRegular, PlugDisconnectedRegular, SearchRegular, WarningRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useCodexStore } from '../../stores/codexStore';
import { EmptyState } from '../../ui/EmptyState';
import { CO_WRITER_LABELS } from './coWriterLabels';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'stretch',
		gap: tokens.spacingVerticalM,
		flex: 1,
		minHeight: 0,
		overflowY: 'auto',
		padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
	},
	checking: {
		display: 'flex',
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
	},
	searched: {
		...typographyStyles.caption1,
		color: tokens.colorNeutralForeground3,
		margin: 0,
		paddingLeft: tokens.spacingHorizontalL,
		textAlign: 'start',
		overflowWrap: 'anywhere',
	},
	pathRow: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	pathInput: {
		width: '100%',
	},
});

function PathField(): JSX.Element {
	const styles = useStyles();
	const configured = useCodexStore((state) => state.status?.configured_path ?? null);
	const setCodexPath = useCodexStore((state) => state.setCodexPath);
	const [draft, setDraft] = useState(configured ?? '');
	return (
		<Field label={CO_WRITER_LABELS.codexPath} hint="The codex.exe of the OpenAI Codex app or of the Codex CLI.">
			<Input
				className={styles.pathInput}
				value={draft}
				placeholder={'C:\\…\\codex.exe'}
				onChange={(_event, data) => setDraft(data.value)}
				onKeyDown={(event) => {
					if (event.key === 'Enter' && draft.trim()) {
						void setCodexPath(draft);
					}
				}}
			/>
			<div className={styles.pathRow}>
				<Button appearance="primary" disabled={!draft.trim()} onClick={() => void setCodexPath(draft)}>
					{CO_WRITER_LABELS.usePath}
				</Button>
				{configured ? (
					<Button
						onClick={() => {
							setDraft('');
							void setCodexPath(null);
						}}
					>
						{CO_WRITER_LABELS.autoDetect}
					</Button>
				) : null}
			</div>
		</Field>
	);
}

function RetryButton(): JSX.Element {
	const loadStatus = useCodexStore((state) => state.loadStatus);
	return (
		<Button icon={<ArrowClockwiseRegular />} onClick={() => void loadStatus(true)}>
			{CO_WRITER_LABELS.retry}
		</Button>
	);
}

export function CoWriterSetup(): JSX.Element {
	const styles = useStyles();
	const status = useCodexStore((state) => state.status);
	const statusLoad = useCodexStore((state) => state.statusLoad);
	const statusError = useCodexStore((state) => state.statusError);
	if (statusLoad === 'loading' || (statusLoad !== 'failed' && status === null)) {
		return (
			<div className={styles.checking}>
				<Spinner size="small" label="Looking for Codex…" />
			</div>
		);
	}
	if (statusLoad === 'failed' || status === null) {
		return (
			<div className={styles.root}>
				<EmptyState icon={PlugDisconnectedRegular} title="The co-writer is not available" titleAs="h3" size="small" live actions={<RetryButton />}>
					{statusError ?? 'The app could not ask the backend about Codex.'}
				</EmptyState>
			</div>
		);
	}
	if (status.state === 'not_found') {
		return (
			<div className={styles.root}>
				<EmptyState icon={SearchRegular} title="Codex was not found" titleAs="h3" size="small" live actions={<RetryButton />}>
					<p>{status.message}</p>
				</EmptyState>
				{status.searched.length > 0 ? (
					<ul className={styles.searched} aria-label="Where the app looked">
						{status.searched.map((place) => (
							<li key={place}>{place}</li>
						))}
					</ul>
				) : null}
				<PathField />
			</div>
		);
	}
	if (status.state === 'signed_out') {
		return (
			<div className={styles.root}>
				<EmptyState icon={PersonLockRegular} title="Sign in to Codex" titleAs="h3" size="small" live actions={<RetryButton />}>
					<p>{status.message}</p>
					{status.version ? <p>Codex {status.version} is installed.</p> : null}
				</EmptyState>
			</div>
		);
	}
	return (
		<div className={styles.root}>
			<EmptyState icon={WarningRegular} title="Codex could not start" titleAs="h3" size="small" live actions={<RetryButton />}>
				<p>{status.message}</p>
			</EmptyState>
			<PathField />
		</div>
	);
}
