import { useGenerationStore } from '../stores/generationStore';
import { useCurrentImageStore } from '../stores/currentImageStore';

export default function ImageBrowserPane(): JSX.Element {
    const availableNames = useCurrentImageStore((state) => state.availableNames);
    const currentName = useCurrentImageStore((state) => state.currentName);
    const currentMetadata = useCurrentImageStore((state) => state.metadata);
    const previous = useCurrentImageStore((state) => state.previous);
    const next = useCurrentImageStore((state) => state.next);
    const first = useCurrentImageStore((state) => state.first);
    const last = useCurrentImageStore((state) => state.last);
    const deleteCurrent = useCurrentImageStore((state) => state.deleteCurrent);
    const progress = useGenerationStore((state) => state.progress);

    const currentIndex = currentName != null ? availableNames.findIndex((item) => item === currentName) : -1;
    const canGoPrevious = currentIndex > 0;
    const canGoNext = currentIndex >= 0 && currentIndex < availableNames.length - 1;
    const canGoFirst = currentIndex > 0;
    const canGoLast = currentIndex >= 0 && currentIndex < availableNames.length - 1;
    const progressRatio = progress && progress.total_steps > 0 ? Math.max(0, Math.min(1, progress.current_step / progress.total_steps)) : 0;
    const imageName = currentMetadata ? currentMetadata.image_path.split(/[\/]/).pop() ?? currentMetadata.output_id : '—';

    return (
        <div className="pane-content-scroll">
            <div className="panel-title-row">
                <h2>Output browser</h2>
                <div className="inline-actions">
                    <button className="ghost-button" onClick={() => void first()} disabled={!canGoFirst} type="button">⇤</button>
                    <button className="ghost-button" onClick={() => void previous()} disabled={!canGoPrevious} type="button">←</button>
                    <button className="ghost-button" onClick={() => void next()} disabled={!canGoNext} type="button">→</button>
                    <button className="ghost-button" onClick={() => void last()} disabled={!canGoLast} type="button">⇥</button>
                    <button className="danger-button" onClick={() => void deleteCurrent()} disabled={!currentMetadata} type="button">Delete</button>
                </div>
            </div>
            <p className="muted small-text">Use left/right arrows to navigate the output folder. New generations always jump to the latest image.</p>
            <div className="progress-area compact-progress">
                <div className="progress-header">
                    <span>{progress?.message || (currentMetadata ? `Viewing output #${currentMetadata.output_id}` : 'No output yet')}</span>
                    {progress?.total_steps ? <span>{progress.current_step}/{progress.total_steps}</span> : null}
                </div>
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.max(2, progressRatio * 100)}%` }} /></div>
            </div>
            <div className="panel-section compact-section">
                <div className="metadata-grid">
                    <div><span className="metadata-label">Current</span><span>{currentMetadata ? `#${currentMetadata.output_id}` : '—'}</span></div>
                    <div><span className="metadata-label">Images</span><span>{availableNames.length}</span></div>
                    <div><span className="metadata-label">Image name</span><span>{imageName}</span></div>
                    <div><span className="metadata-label">Seed</span><span>{currentMetadata?.seed ?? '—'}</span></div>
                    <div><span className="metadata-label">Size</span><span>{currentMetadata ? `${currentMetadata.width} × ${currentMetadata.height}` : '—'}</span></div>
                </div>
            </div>
        </div>
    );
}
