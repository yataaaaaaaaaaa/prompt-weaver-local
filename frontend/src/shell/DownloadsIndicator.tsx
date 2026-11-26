// The downloads indicator at the bottom of the navigation rail: every running download, whatever started it (Models
// installs, "Use these LoRAs" of an online image, IP-Adapter files: tasksStore selectActiveDownloads), visible from any
// section. The button shows the overall progress under its caption; its popover lists each download with its progress
// (the TransferProgress of the Models section) and offers 'Show in Models', where downloads are cancelled and retried.
// While nothing downloads, the popover says so.
import {
	Body1,
	Body1Strong,
	Button,
	makeStyles,
	Popover,
	PopoverSurface,
	PopoverTrigger,
	ProgressBar,
	Subtitle2,
	tokens,
	useId,
} from '@fluentui/react-components';
import { ArrowDownloadRegular, LibraryRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import type { DownloadTaskEvent } from '../api/types';
import { SECTION_LABELS } from '../app/sections';
import { downloadProgressText, downloadProgressValue, TransferProgress } from '../features/models/TransferProgress';
import { useNavigationStore } from '../stores/navigationStore';
import { downloadProgressOf, selectActiveDownloadRatio, selectActiveDownloads, useTasksStore } from '../stores/tasksStore';
import { useRailStyles } from './railStyles';

/** Accessible name of the indicator button (the e2e suite and the rail tests find it by this name). */
export const DOWNLOADS_LABEL = 'Downloads';

const useStyles = makeStyles({
	surface: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		width: '360px',
		maxWidth: 'calc(100vw - 120px)',
	},
	heading: {
		margin: 0,
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
		maxHeight: '320px',
		overflowY: 'auto',
	},
	item: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
	},
	title: {
		overflowWrap: 'anywhere',
	},
	idle: {
		color: tokens.colorNeutralForeground2,
	},
	actions: {
		display: 'flex',
		justifyContent: 'flex-end',
	},
});

/** Spoken count of the running downloads ('No downloads running', '1 download running', '3 downloads running'). */
export function runningDownloadsText(count: number): string {
	if (count === 0) {
		return 'No downloads running';
	}
	return `${count} download${count === 1 ? '' : 's'} running`;
}

function DownloadItem({ event }: { event: DownloadTaskEvent }): JSX.Element {
	const styles = useStyles();
	const progress = downloadProgressOf(event);
	const titleId = useId('download-title-');
	return (
		<li className={styles.item} aria-labelledby={titleId}>
			<Body1Strong id={titleId} className={styles.title}>
				{event.title}
			</Body1Strong>
			<TransferProgress label={`Downloading ${event.title}`} text={downloadProgressText(progress)} value={downloadProgressValue(progress)} />
		</li>
	);
}

export function DownloadsIndicator(): JSX.Element {
	const styles = useStyles();
	const rail = useRailStyles();
	const downloads = useTasksStore(selectActiveDownloads);
	const ratio = useTasksStore(selectActiveDownloadRatio);
	const showSection = useNavigationStore((state) => state.showSection);
	const [open, setOpen] = useState(false);
	const headingId = useId('downloads-heading-');
	const count = downloads.length;
	return (
		<Popover open={open} onOpenChange={(_event, data) => setOpen(data.open)} positioning="after-bottom" withArrow trapFocus>
			<PopoverTrigger disableButtonEnhancement>
				<Button
					appearance="subtle"
					className={rail.button}
					icon={{ children: <ArrowDownloadRegular />, className: rail.buttonIcon }}
					aria-description={runningDownloadsText(count)}
					aria-expanded={open}
				>
					{DOWNLOADS_LABEL}
					{count > 0 ? (
						<ProgressBar className={rail.buttonProgress} value={ratio} max={1} thickness="medium" aria-hidden />
					) : null}
				</Button>
			</PopoverTrigger>
			<PopoverSurface className={styles.surface} aria-labelledby={headingId}>
				<Subtitle2 as="h2" id={headingId} className={styles.heading}>
					{DOWNLOADS_LABEL}
				</Subtitle2>
				{count === 0 ? (
					<Body1 className={styles.idle}>{runningDownloadsText(0)}.</Body1>
				) : (
					<ul className={styles.list} aria-label="Running downloads">
						{downloads.map((event) => (
							<DownloadItem key={event.task_id} event={event} />
						))}
					</ul>
				)}
				<div className={styles.actions}>
					<Button
						appearance={count > 0 ? 'primary' : 'secondary'}
						icon={<LibraryRegular />}
						onClick={() => {
							setOpen(false);
							showSection('models');
						}}
					>
						{`Show in ${SECTION_LABELS.models}`}
					</Button>
				</div>
			</PopoverSurface>
		</Popover>
	);
}
