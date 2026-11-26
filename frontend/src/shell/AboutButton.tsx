// The session information at the bottom of the navigation rail: the 'About' button and its popover, which names the
// data directory the backend uses (sessionStore.dataDir, where outputs, saved state, trash and characters live) and
// the backend address. The one place the UI shows the data directory.
import { Body1, Button, Caption1, makeStyles, Popover, PopoverSurface, PopoverTrigger, Subtitle2, tokens, useId } from '@fluentui/react-components';
import { InfoRegular } from '@fluentui/react-icons';
import { BACKEND_URL } from '../api/config';
import { useSessionStore } from '../stores/sessionStore';
import { useRailStyles } from './railStyles';

/** Accessible name of the button (the e2e suite finds it by this name). */
export const ABOUT_LABEL = 'About';
/** The popover lines start with these (the visual baselines mask them: they differ between runs). */
export const DATA_DIRECTORY_PREFIX = 'Data directory: ';
export const BACKEND_PREFIX = 'Backend: ';

const useStyles = makeStyles({
	surface: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		width: '420px',
		maxWidth: 'calc(100vw - 120px)',
	},
	heading: {
		margin: 0,
	},
	path: {
		overflowWrap: 'anywhere',
		userSelect: 'text',
	},
	hint: {
		color: tokens.colorNeutralForeground2,
	},
});

/** The 'About' popover lines: the data directory (an em dash before the session is ready) and the backend. */
export function aboutLines(dataDir: string): { dataDirectory: string; backend: string } {
	return { dataDirectory: `${DATA_DIRECTORY_PREFIX}${dataDir || '—'}`, backend: `${BACKEND_PREFIX}${BACKEND_URL}` };
}

export function AboutButton(): JSX.Element {
	const styles = useStyles();
	const rail = useRailStyles();
	const dataDir = useSessionStore((state) => state.dataDir);
	const headingId = useId('about-heading-');
	const lines = aboutLines(dataDir);
	return (
		<Popover positioning="after-bottom" withArrow>
			<PopoverTrigger disableButtonEnhancement>
				<Button appearance="subtle" className={rail.button} icon={{ children: <InfoRegular />, className: rail.buttonIcon }}>
					{ABOUT_LABEL}
				</Button>
			</PopoverTrigger>
			<PopoverSurface className={styles.surface} aria-labelledby={headingId}>
				<Subtitle2 as="h2" id={headingId} className={styles.heading}>
					Prompt Weaver
				</Subtitle2>
				<Body1 className={styles.path}>{lines.dataDirectory}</Body1>
				<Caption1 className={styles.hint}>Outputs, saved state, the trash and the characters live there.</Caption1>
				<Body1 className={styles.path}>{lines.backend}</Body1>
			</PopoverSurface>
		</Popover>
	);
}
