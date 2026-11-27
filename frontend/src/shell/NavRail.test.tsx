import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DownloadTaskEvent } from '../api/types';
import { commandForKeyEvent } from '../app/commands';
import { SECTION_DESCRIPTIONS, SECTION_IDS, SECTION_LABELS, SHELL_LABELS } from '../app/sections';
import { useNavigationStore } from '../stores/navigationStore';
import { useSessionStore } from '../stores/sessionStore';
import { useTasksStore } from '../stores/tasksStore';
import { downloadEvent } from '../test/modelLibraryData';
import { renderWithProviders } from '../test/render';
import { runningDownloadsText } from './DownloadsIndicator';
import { NavRail, navItemDescription } from './NavRail';

// The rail only needs the sections' icons; their views have their own tests.
vi.mock('./CreateSection', () => ({ CreateSection: () => null }));
vi.mock('../features/models/ModelsSection', () => ({ ModelsSection: () => null }));
vi.mock('../features/images/ImagesSection', () => ({ ImagesSection: () => null }));
vi.mock('../features/characters/CharactersSection', () => ({ CharactersSection: () => null }));

function download(taskId: string, title: string, current: number, total: number, stage: DownloadTaskEvent['stage'] = 'downloading'): DownloadTaskEvent {
	return downloadEvent(taskId, { title, current, total, stage });
}

function setDownloads(...events: DownloadTaskEvent[]): void {
	act(() => useTasksStore.setState({ events: Object.fromEntries(events.map((event) => [event.task_id, event])) }));
}

/** In jsdom, Tabster's modalizer (the Downloads popover traps the focus) sometimes marks the dialog itself aria-hidden
 *  when many test files run at once: these queries include hidden elements, and the dialog is found in the DOM. The
 *  real browser's accessibility tree is checked by e2e/shell/downloads.spec.ts. */
const IN_MODAL = { hidden: true } as const;

/** The open Downloads popover: the dialog labelled by its 'Downloads' heading. */
async function downloadsPopover(): Promise<HTMLElement> {
	return waitFor(
		() => {
			const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
			expect(dialog).not.toBeNull();
			expect(document.getElementById(dialog!.getAttribute('aria-labelledby') ?? '')).toHaveTextContent('Downloads');
			return dialog!;
		},
		{ timeout: 15_000 },
	);
}

const rail = () => screen.getByRole('navigation', { name: SHELL_LABELS.navigation });
const item = (name: string) => within(rail()).getByRole('button', { name });

describe('NavRail', () => {
	it('has one item per section, named exactly after it, the shown one current', () => {
		renderWithProviders(<NavRail />);

		for (const section of SECTION_IDS) {
			expect(item(SECTION_LABELS[section])).toBeInTheDocument();
		}
		expect(item('Create')).toHaveAttribute('aria-current', 'page');
		expect(item('Models')).toHaveAttribute('aria-current', 'false');
	});

	it('describes each section and its Ctrl+1..5 shortcut', () => {
		renderWithProviders(<NavRail />);

		expect(item('Create')).toHaveAttribute('aria-description', SECTION_DESCRIPTIONS.create);
		expect(item('Create')).toHaveAttribute('aria-keyshortcuts', 'Control+1');
		expect(item('Characters')).toHaveAttribute('aria-keyshortcuts', 'Control+4');
		expect(item('Story')).toHaveAttribute('aria-keyshortcuts', 'Control+5');
		expect(item('Story')).toHaveAttribute('aria-description', SECTION_DESCRIPTIONS.story);
	});

	it('shows a section when its item is clicked, and keeps the focus on the rail', async () => {
		const { user } = renderWithProviders(<NavRail />);

		await user.click(item('Images'));

		expect(useNavigationStore.getState().section).toBe('images');
		expect(item('Images')).toHaveAttribute('aria-current', 'page');
		expect(item('Create')).toHaveAttribute('aria-current', 'false');
		expect(item('Images')).toHaveFocus();
		expect(useNavigationStore.getState().sectionFocus).toBeNull();
	});

	it('keeps its arrow keys for moving between items: they never browse outputs', () => {
		renderWithProviders(<NavRail />);
		const press = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: item('Create') };

		expect(commandForKeyEvent({ ...press, key: 'ArrowDown' })).toBeNull();
		expect(commandForKeyEvent({ ...press, key: 'F6' })).toBe('next-region');
		expect(commandForKeyEvent({ ...press, key: '2', ctrlKey: true })).toBe('show-models');
	});

	it('follows the shown section of the store', () => {
		renderWithProviders(<NavRail />);

		act(() => useNavigationStore.getState().showSection('characters'));

		expect(item('Characters')).toHaveAttribute('aria-current', 'page');
	});

	it('badges Models with the running downloads, counted in its description and never in its name', () => {
		renderWithProviders(<NavRail />);
		expect(within(item('Models')).queryByText('2')).not.toBeInTheDocument();

		setDownloads(download('a', 'Aurora XL - v4.0', 1, 4), download('b', 'Pixel Forge', 0, 0, 'queued'), download('c', 'Done', 4, 4, 'complete'));

		const models = item('Models');
		expect(models).toHaveAttribute('aria-description', `${SECTION_DESCRIPTIONS.models}. 2 downloads running`);
		expect(within(models).getByText('2')).toBeInTheDocument();
	});

	it('lists every running download with its progress, and goes to Models from there', async () => {
		const { user } = renderWithProviders(<NavRail />);
		setDownloads(download('a', 'Aurora XL - v4.0', 3 * 1024 * 1024, 6 * 1024 * 1024));

		const button = item('Downloads');
		expect(button).toHaveAttribute('aria-description', '1 download running');
		await user.click(button);

		const popover = await downloadsPopover();
		const list = within(popover).getByRole('list', { name: 'Running downloads', ...IN_MODAL });
		expect(within(list).getByRole('listitem', { name: 'Aurora XL - v4.0', ...IN_MODAL })).toBeInTheDocument();
		expect(within(list).getByRole('progressbar', { name: 'Downloading Aurora XL - v4.0', ...IN_MODAL })).toHaveAttribute('aria-valuenow', '0.5');
		expect(within(list).getByText('3.0 MB of 6.0 MB')).toBeInTheDocument();

		await user.click(within(popover).getByRole('button', { name: 'Show in Models', ...IN_MODAL }));

		expect(useNavigationStore.getState().section).toBe('models');
		await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
	});

	it('says that nothing downloads while idle', async () => {
		const { user } = renderWithProviders(<NavRail />);

		expect(item('Downloads')).toHaveAttribute('aria-description', 'No downloads running');
		await user.click(item('Downloads'));

		const popover = await downloadsPopover();
		expect(within(popover).getByText('No downloads running.')).toBeInTheDocument();
		expect(within(popover).queryByRole('list', IN_MODAL)).not.toBeInTheDocument();
	});

	it('shows the data directory in the About popover', async () => {
		useSessionStore.setState({ dataDir: 'C:\\data\\prompt-weaver' });
		const { user } = renderWithProviders(<NavRail />);

		await user.click(item('About'));

		const popover = await screen.findByRole('group', { name: 'Prompt Weaver' }, { timeout: 15_000 });
		expect(within(popover).getByText('Data directory: C:\\data\\prompt-weaver')).toBeInTheDocument();
		expect(within(popover).getByText(/^Backend: http/)).toBeInTheDocument();
	});
});

describe('rail texts', () => {
	it('counts the running downloads', () => {
		expect(runningDownloadsText(0)).toBe('No downloads running');
		expect(runningDownloadsText(1)).toBe('1 download running');
		expect(runningDownloadsText(3)).toBe('3 downloads running');
		expect(navItemDescription('models', 0)).toBe(SECTION_DESCRIPTIONS.models);
		expect(navItemDescription('images', 2)).toBe(SECTION_DESCRIPTIONS.images);
	});

});
