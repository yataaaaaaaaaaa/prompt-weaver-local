import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { cycleVisibilityMode } from './app/appHelpers';
import CategoryCard from './components/CategoryCard';
import ControlsPane from './components/ControlsPane';
import FloatingPane from './components/FloatingPane';
import ImageBrowserPane from './components/ImageBrowserPane';
import ImagePane from './components/ImagePane';
import UsedSelectionsPane from './components/UsedSelectionsPane';
import { useAppStore } from './stores/appStore';
import { useCategoriesStore } from './stores/categoriesStore';
import { useGenerationStore } from './stores/generationStore';
import { useCurrentImageStore } from './stores/currentImageStore';
import { CategoryId } from './utils/CategoryId';


export default function App(): JSX.Element {
    const bootstrap = useAppStore((state) => state.bootstrap);
    const generate = useAppStore((state) => state.generate);
    const toggleContinuousGenerate = useAppStore((state) => state.toggleContinuousGenerate);
    const categories = useCategoriesStore((state) => state.categories);
    const reorganizeCategories = useCategoriesStore((state) => state.reorganizeCategories);
    const setCategories = useCategoriesStore((state) => state.setCategories);
    const loading = useGenerationStore((state) => state.loading);
    const error = useGenerationStore((state) => state.error);
    const setError = useGenerationStore((state) => state.setError);
    const setProgress = useGenerationStore((state) => state.setProgress);
    const [visibilityMode, setVisibilityMode] = useState<'all' | 'categories-only' | 'panes-only'>('all');
    const previousImage = useCurrentImageStore((state) => state.previous);
    const nextImage = useCurrentImageStore((state) => state.next);
    const lastShortcutCommandRef = useRef<{ command: string; timestamp: number } | null>(null);

    useEffect(() => {
        void bootstrap();
    }, [bootstrap]);

    useEffect(() => api.connectProgress(setProgress), [setProgress]);

    const runShortcutCommand = useMemo(() => {
        return (command: string) => {
            const now = Date.now();
            const previousCommand = lastShortcutCommandRef.current;
            if (previousCommand && previousCommand.command === command && now - previousCommand.timestamp < 200) {
                return;
            }
            lastShortcutCommandRef.current = { command, timestamp: now };

            if (command === 'generate') {
                void generate();
                return;
            }
            if (command === 'toggle-continuous-generate') {
                void toggleContinuousGenerate();
                return;
            }
            if (command === 'toggle-visibility') {
                setVisibilityMode((current) => cycleVisibilityMode(current));
                return;
            }
            if (command === 'reorganize-categories') {
                reorganizeCategories();
                return;
            }
            if (command === 'compute-indirectly-disabled') {
                setCategories([...useCategoriesStore.getState().categories]);
                setError(null);
            }
        };
    }, [generate, reorganizeCategories, setCategories, setError, toggleContinuousGenerate]);

    useEffect(() => {
        const removeListener = window.promptWeaverDesktop?.onCommand?.((command) => {
            runShortcutCommand(command);
        });
        return () => {
            removeListener?.();
        };
    }, [runShortcutCommand]);

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent): void {
            const target = event.target;
            const isEditableElement = target instanceof HTMLElement
                && (target.tagName.toLowerCase() === 'textarea'
                    || (target.tagName.toLowerCase() === 'input' && (target as HTMLInputElement).type !== 'button')
                    || target.isContentEditable);

            if (!isEditableElement && !event.ctrlKey && !event.metaKey && !event.altKey) {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    void previousImage();
                    return;
                }
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    void nextImage();
                    return;
                }
            }

            if (!(event.ctrlKey || event.metaKey) || event.altKey) {
                return;
            }

            if (isEditableElement && event.key.toLowerCase() !== 'g' && event.key.toLowerCase() !== 't') {
                return;
            }

            const key = event.key.toLowerCase();
            const commandByKey: Record<string, string> = {
                g: 'generate',
                t: 'toggle-continuous-generate',
                h: 'toggle-visibility',
                o: 'reorganize-categories',
                d: 'compute-indirectly-disabled',
            };
            const command = commandByKey[key];
            if (!command) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            runShortcutCommand(command);
        }

        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [nextImage, previousImage, runShortcutCommand]);

    if (loading) {
        return <div className="loading-screen">{error || 'Loading…'}</div>;
    }

    const showCategories = visibilityMode !== 'panes-only';
    const showPanes = visibilityMode !== 'categories-only';

    return (
        <div className="app-shell">
            <div className="workspace-surface">
                {error ? <div className="global-error">{error}</div> : null}

                {showCategories && categories.map((category) => (
                    <CategoryCard key={category.text} categoryId={CategoryId.from(category.text)} />
                ))}

                {showPanes && (
                    <>
                        <FloatingPane identifier="pane-image" kind="pane" defaultLayout={{ x: 24, y: 24, width: 640, height: 720 }}>
                            {() => <ImagePane />}
                        </FloatingPane>

                        <FloatingPane identifier="pane-browser" kind="pane" defaultLayout={{ x: 690, y: 24, width: 360, height: 280 }}>
                            {() => <ImageBrowserPane />}
                        </FloatingPane>

                        <FloatingPane identifier="pane-controls" kind="pane" defaultLayout={{ x: 1060, y: 24, width: 420, height: 720 }}>
                            {() => <ControlsPane />}
                        </FloatingPane>

                        <FloatingPane identifier="pane-used" kind="pane" defaultLayout={{ x: 690, y: 320, width: 790, height: 420 }}>
                            {() => <UsedSelectionsPane />}
                        </FloatingPane>
                    </>
                )}
            </div>
        </div>
    );
}
