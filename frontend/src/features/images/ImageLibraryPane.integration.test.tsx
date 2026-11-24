// Image library pane over the REAL stores (image library, catalog, library, tasks, notifications): only the HTTP
// client is replaced. Covers the wiring the view tests mock (useImageLoraRows / useImageCheckpointRow) and the
// one-click "Use these LoRAs" flow end to end on the frontend: open an image, install the missing LoRA through the
// catalog store (progress from the tasks store), then the selection holds exactly the image's LoRAs with its weights.
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { InstallResponse } from '../../api/types';
import { selectSelectedLoras, useLibraryStore } from '../../stores/libraryStore';
import { useTasksStore } from '../../stores/tasksStore';
import { CHILLOUT, DETAIL_IMAGE, DETAIL_IMAGE_RESOLUTION, KIM_LORA } from '../../test/imageLibraryData';
import { DETAIL_TWEAKER, DETAIL_TWEAKER_VERSION, downloadEvent, installedModel } from '../../test/modelLibraryData';
import { renderWithProviders } from '../../test/render';
import { ImageLibraryPane } from './ImageLibraryPane';

const KIM_VERSION = KIM_LORA.versions[0];
const ADD_DETAIL_PATH = 'D:/models/loras/add_detail.safetensors';
const KIM_PATH = 'D:/models/loras/kim_v_1.safetensors';
const OLD_LORA_PATH = 'D:/models/loras/old_style.safetensors';

/** The library holds add_detail (installed earlier, not selected) and 'old_style' selected at 0.8. */
function seedLibrary(): { addDetailId: string; oldId: string } {
	const addDetailId = useLibraryStore
		.getState()
		.registerInstalled(installedModel(DETAIL_TWEAKER, DETAIL_TWEAKER_VERSION, ADD_DETAIL_PATH), { select: false });
	if (addDetailId === null) {
		throw new Error('library seed failed');
	}
	const oldId = 'old-style';
	const { loras } = useLibraryStore.getState();
	useLibraryStore.getState().replaceAll({
		loras: [...loras, { id: oldId, name: 'old_style.safetensors', path: OLD_LORA_PATH, source: null }],
		selectedLoras: [{ id: oldId, weight: 0.8 }],
	});
	return { addDetailId, oldId };
}

function mockApi() {
	vi.spyOn(api, 'searchImages').mockResolvedValue({ items: [DETAIL_IMAGE], next_cursor: null });
	vi.spyOn(api, 'listFavoriteImages').mockResolvedValue([]);
	const resolve = vi.spyOn(api, 'resolveImageResources').mockResolvedValue(DETAIL_IMAGE_RESOLUTION);
	const answers: InstallResponse[] = [
		{ state: 'downloading', installed: null, task_id: 'task-kim' },
		{ state: 'installed', installed: installedModel(KIM_LORA, KIM_VERSION, KIM_PATH), task_id: null },
	];
	const installModel = vi.spyOn(api, 'installModel').mockImplementation(async () => answers.shift()!);
	return { resolve, installModel };
}

describe('ImageLibraryPane with the real stores', () => {
	it('shows the resolved LoRAs and sets exactly them, with their weights, in one click', async () => {
		const { addDetailId, oldId } = seedLibrary();
		const { resolve, installModel } = mockApi();
		const { user } = renderWithProviders(<ImageLibraryPane />);

		await user.click(await screen.findByRole('button', { name: 'Image by alice' }));

		const loras = await screen.findByRole('list', { name: 'LoRAs of this image' });
		await waitFor(() => expect(within(loras).getAllByRole('listitem')).toHaveLength(3));
		expect(resolve).toHaveBeenCalledWith({ provider: 'civitai', resources: DETAIL_IMAGE.resources });
		const [detailRow, kimRow, nameOnlyRow] = within(loras).getAllByRole('listitem');
		expect(within(detailRow).getByText('Detail Tweaker LoRA - v1.0')).toBeInTheDocument();
		expect(within(detailRow).getByText('In library')).toBeInTheDocument();
		expect(within(detailRow).getByText('Weight 1')).toBeInTheDocument();
		expect(within(kimRow).getByText('Kim LoRA - v1')).toBeInTheDocument();
		expect(within(kimRow).getByText('Available to download')).toBeInTheDocument();
		expect(within(kimRow).getByText('Weight 0.6')).toBeInTheDocument();
		expect(within(nameOnlyRow).getByText('realistic filter [IL]')).toBeInTheDocument();
		expect(within(nameOnlyRow).getByText('Not identified')).toBeInTheDocument();
		expect(screen.getByText(`${CHILLOUT.name} - ${CHILLOUT.versions[0].name}`)).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Use these LoRAs' }));

		// The missing LoRA downloads through the catalog store; its row shows the download.
		await waitFor(() => expect(within(kimRow).getByText('Downloading')).toBeInTheDocument());
		expect(installModel).toHaveBeenCalledWith({ provider: 'civitai', version_id: KIM_VERSION.id, file_id: null });
		expect(screen.getByRole('button', { name: 'Use these LoRAs' })).toBeDisabled();
		expect(selectSelectedLoras(useLibraryStore.getState())).toEqual([{ id: oldId, weight: 0.8 }]);

		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-kim', { stage: 'complete' })));

		await waitFor(() => expect(screen.getByRole('button', { name: 'Use these LoRAs' })).toBeEnabled());
		const kimId = useLibraryStore.getState().loras.find((lora) => lora.path === KIM_PATH)?.id;
		expect(kimId).toBeDefined();
		expect(selectSelectedLoras(useLibraryStore.getState())).toEqual([
			{ id: addDetailId, weight: 1 },
			{ id: kimId, weight: 0.6 },
		]);
		expect(within(kimRow).getByText('In library')).toBeInTheDocument();
		expect(installModel).toHaveBeenCalledTimes(2);
	}, 20_000);
});
