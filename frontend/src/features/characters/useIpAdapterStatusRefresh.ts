// Keeps the IP-Adapter status of the views current: asks the IP-Adapter store to refresh on mount and whenever the
// selected model's path changes. The store dedupes (already loaded or loading for that model path), so every view
// showing reference support may call it.
import { useEffect } from 'react';
import { useIpAdapterStore } from '../../stores/ipAdapterStore';
import { selectSelectedModel, useLibraryStore } from '../../stores/libraryStore';

export function useIpAdapterStatusRefresh(): void {
	const modelPath = useLibraryStore((state) => selectSelectedModel(state)?.path ?? null);
	useEffect(() => {
		void useIpAdapterStore.getState().refresh();
	}, [modelPath]);
}
