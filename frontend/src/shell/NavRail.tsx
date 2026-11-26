// The navigation rail (Fluent 2 Nav, narrow: each item's icon above its caption): one item per task section
// (src/app/sections.ts), the shown one current (aria-current="page", filled icon, selection indicator). A <nav>
// landmark named SHELL_LABELS.navigation and an F6 region ('nav'). Each item's accessible name is exactly the section's
// name; its tooltip says what the section is for and its shortcut (Ctrl+1..4), also exposed as aria-description and
// aria-keyshortcuts. The Models item carries the running downloads count (a badge; the count is in its description,
// never in its name). At the bottom: the downloads indicator and the About button (data directory). The rail owns its
// plain keys (the arrow keys move between its items), so they never browse outputs.
import { CounterBadge, mergeClasses, NavDrawer, NavDrawerBody, NavDrawerFooter, NavItem, Tooltip } from '@fluentui/react-components';
import { F6_REGION_ATTRIBUTE, SECTION_COMMANDS, SECTION_DESCRIPTIONS, SECTION_IDS, SECTION_LABELS, SHELL_LABELS, type SectionId } from '../app/sections';
import { useNavigationStore } from '../stores/navigationStore';
import { useActiveDownloadCount } from '../stores/tasksStore';
import { ariaKeyShortcuts, ownsKeysProps, withShortcut } from '../ui/keyboard';
import { AboutButton } from './AboutButton';
import { DownloadsIndicator, runningDownloadsText } from './DownloadsIndicator';
import { useRailStyles } from './railStyles';
import { SECTION_VIEWS } from './sectionViews';

function isSectionId(value: unknown): value is SectionId {
	return (SECTION_IDS as readonly unknown[]).includes(value);
}

/** The accessible description of a rail item: what the section is for, and for Models the running downloads. */
export function navItemDescription(section: SectionId, activeDownloads: number): string {
	return section === 'models' && activeDownloads > 0
		? `${SECTION_DESCRIPTIONS[section]}. ${runningDownloadsText(activeDownloads)}`
		: SECTION_DESCRIPTIONS[section];
}

function RailItem({ section, selected }: { section: SectionId; selected: boolean }): JSX.Element {
	const styles = useRailStyles();
	const downloads = useActiveDownloadCount();
	const Icon = SECTION_VIEWS[section].icon;
	const count = section === 'models' ? downloads : 0;
	return (
		<Tooltip content={withShortcut(SECTION_DESCRIPTIONS[section], SECTION_COMMANDS[section])} relationship="inaccessible" positioning="after">
			<NavItem
				value={section}
				icon={{ children: <Icon />, className: styles.icon }}
				aria-label={SECTION_LABELS[section]}
				aria-description={navItemDescription(section, count)}
				aria-keyshortcuts={ariaKeyShortcuts(SECTION_COMMANDS[section])}
				className={mergeClasses(styles.item, selected && styles.itemSelected)}
			>
				{SECTION_LABELS[section]}
				{count > 0 ? <CounterBadge className={styles.badge} count={count} size="small" color="brand" aria-hidden /> : null}
			</NavItem>
		</Tooltip>
	);
}

export function NavRail(): JSX.Element {
	const styles = useRailStyles();
	const section = useNavigationStore((state) => state.section);
	const showSection = useNavigationStore((state) => state.showSection);
	return (
		<NavDrawer
			open
			type="inline"
			// Always open: no slide-in when the app starts (a mounted inline drawer animates in by default).
			surfaceMotion={null}
			selectedValue={section}
			onNavItemSelect={(_event, data) => {
				if (isSectionId(data.value)) {
					showSection(data.value);
				}
			}}
			aria-label={SHELL_LABELS.navigation}
			tabIndex={-1}
			className={styles.rail}
			{...{ [F6_REGION_ATTRIBUTE]: 'nav' }}
			// The arrow keys move between the rail items (Fluent Nav), never through the output history.
			{...ownsKeysProps}
		>
			<NavDrawerBody className={styles.body}>
				{SECTION_IDS.map((id) => (
					<RailItem key={id} section={id} selected={id === section} />
				))}
			</NavDrawerBody>
			<NavDrawerFooter className={styles.footer}>
				<DownloadsIndicator />
				<AboutButton />
			</NavDrawerFooter>
		</NavDrawer>
	);
}
