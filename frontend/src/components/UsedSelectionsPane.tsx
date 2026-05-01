import { useMemo } from 'react';
import type { ForbiddenAssociationEndpoint } from '../types';
import { useAppStore } from '../stores/appStore';
import { useForbiddenAssociationsStore } from '../stores/forbiddenAssociationsStore';
import { useCurrentImageStore } from '../stores/currentImageStore';
import { normalizeTagId, splitPromptTags } from '../utils';

function sameSelection(left: { category_name: string; prompt_text: string }, right: { category_name: string; prompt_text: string }): boolean {
    return left.category_name === right.category_name && left.prompt_text === right.prompt_text;
}

function sameEndpoint(left: ForbiddenAssociationEndpoint, right: ForbiddenAssociationEndpoint): boolean {
    return left.mode === right.mode
        && sameSelection(left.selection, right.selection)
        && normalizeTagId(left.tag_text ?? '') === normalizeTagId(right.tag_text ?? '');
}

function describeSource(source: ForbiddenAssociationEndpoint): string {
    if (source.mode === 'prompt') {
        return 'sub-prompt';
    }
    if (source.mode === 'category') {
        return 'category';
    }
    return `tag '${source.tag_text ?? ''}'`;
}

function CopyIcon(): JSX.Element {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M5 2.75A1.75 1.75 0 0 1 6.75 1h5.5A1.75 1.75 0 0 1 14 2.75v6.5A1.75 1.75 0 0 1 12.25 11h-5.5A1.75 1.75 0 0 1 5 9.25zm1.75-.25a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25z" />
            <path fill="currentColor" d="M2 5.75C2 4.784 2.784 4 3.75 4h.5v1.5h-.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-.5H11v.5A1.75 1.75 0 0 1 9.25 14h-5.5A1.75 1.75 0 0 1 2 12.25z" />
        </svg>
    );
}

async function copyPromptText(text: string): Promise<void> {
    if (!text) {
        return;
    }
    await navigator.clipboard.writeText(text);
}

export default function UsedSelectionsPane(): JSX.Element {
    const currentMetadata = useCurrentImageStore((state) => state.metadata);
    const rules = useForbiddenAssociationsStore((state) => state.rules);
    const toggleSelectionAssociation = useForbiddenAssociationsStore((state) => state.toggleSelectionAssociation);
    const source = useAppStore((state) => state.usedAssociationSource);
    const setSource = useAppStore((state) => state.setUsedAssociationSource);
    const clearSource = useAppStore((state) => state.clearUsedAssociationSource);

    const items = useMemo(() => {
        const store = useForbiddenAssociationsStore.getState();
        const selections = currentMetadata?.selections ?? [];
        return selections.map((selection) => {
            const promptEndpoint: ForbiddenAssociationEndpoint = { mode: 'prompt', selection };
            const categoryEndpoint: ForbiddenAssociationEndpoint = { mode: 'category', selection };
            return {
                selection,
                promptEndpoint,
                categoryEndpoint,
                promptForbidden: source ? store.hasAssociation(source, promptEndpoint) : false,
                categoryForbidden: source ? store.hasAssociation(source, categoryEndpoint) : false,
                sourcePromptSelected: source ? sameEndpoint(source, promptEndpoint) : false,
                sourceCategorySelected: source ? sameEndpoint(source, categoryEndpoint) : false,
                tags: splitPromptTags(selection.prompt_text).map((tagText) => {
                    const tagEndpoint: ForbiddenAssociationEndpoint = { mode: 'tag', selection, tag_text: tagText };
                    return {
                        tagText,
                        tagEndpoint,
                        tagForbidden: source ? store.hasAssociation(source, tagEndpoint) : false,
                        sourceTagSelected: source ? sameEndpoint(source, tagEndpoint) : false,
                    };
                }),
            };
        });
    }, [currentMetadata?.selections, rules, source]);

    const selectionHint = source
        ? `Source selected: ${describeSource(source)}. Choose P, C, or a tag on another row to create or disable the association.`
        : 'Pick P, C, or a tag on a row to select the source association target.';

    return (
        <div className="pane-content-scroll">
            <div className="panel-title-row"><h2>Used sub-prompts</h2></div>
            <p className="muted small-text">P = sub-prompt association. C = category association. Click a tag chip for tag association.</p>
            <div className="muted small-text used-selection-hint">{selectionHint}</div>
            <div className="used-selection-list">
                {items.map(({ selection, promptEndpoint, categoryEndpoint, promptForbidden, categoryForbidden, sourcePromptSelected, sourceCategorySelected, tags }, index) => (
                    <div key={`${selection.category_name}::${selection.prompt_text}::${index}`} className={[
                        'used-selection-row',
                        sourcePromptSelected ? 'used-selection-row-prompt-selected' : '',
                        sourceCategorySelected ? 'used-selection-row-category-selected' : '',
                        promptForbidden ? 'used-selection-row-has-prompt-forbidden' : '',
                        categoryForbidden ? 'used-selection-row-has-category-forbidden' : '',
                    ].filter(Boolean).join(' ')}>
                        <div className="used-selection-row-top">
                            <div className="used-selection-category">{selection.category_name}</div>
                            <div className="used-selection-actions">
                                <button
                                    className="ghost-button compact-icon-button used-copy-button"
                                    type="button"
                                    title={selection.prompt_text || 'Empty sub-prompt'}
                                    aria-label={selection.prompt_text ? `Copy full sub-prompt: ${selection.prompt_text}` : 'Copy empty sub-prompt'}
                                    onClick={() => {
                                        void copyPromptText(selection.prompt_text);
                                    }}
                                >
                                    <CopyIcon />
                                </button>
                                <button className={['used-mode-button', sourcePromptSelected ? 'used-mode-button-selected' : '', promptForbidden ? 'used-mode-button-forbidden' : ''].filter(Boolean).join(' ')} type="button" onClick={() => {
                                    if (sourcePromptSelected) {
                                        clearSource();
                                        return;
                                    }
                                    if (source) {
                                        if (sameSelection(source.selection, selection)) {
                                            clearSource();
                                            return;
                                        }
                                        toggleSelectionAssociation(source, promptEndpoint);
                                        clearSource();
                                        return;
                                    }
                                    setSource(promptEndpoint);
                                }}>P</button>
                                <button className={['used-mode-button', sourceCategorySelected ? 'used-mode-button-selected-category' : '', categoryForbidden ? 'used-mode-button-forbidden-category' : ''].filter(Boolean).join(' ')} type="button" onClick={() => {
                                    if (sourceCategorySelected) {
                                        clearSource();
                                        return;
                                    }
                                    if (source) {
                                        if (sameSelection(source.selection, selection) || source.selection.category_name === selection.category_name) {
                                            clearSource();
                                            return;
                                        }
                                        toggleSelectionAssociation(source, categoryEndpoint);
                                        clearSource();
                                        return;
                                    }
                                    setSource(categoryEndpoint);
                                }}>C</button>
                            </div>
                        </div>
                        {tags.length ? (
                            <div className="used-selection-tags">
                                {tags.map(({ tagText, tagEndpoint, tagForbidden, sourceTagSelected }) => (
                                    <button
                                        key={`${selection.category_name}::${selection.prompt_text}::${normalizeTagId(tagText)}`}
                                        className={[
                                            'used-tag-button',
                                            sourceTagSelected ? 'used-tag-button-selected' : '',
                                            tagForbidden ? 'used-tag-button-forbidden' : '',
                                        ].filter(Boolean).join(' ')}
                                        type="button"
                                        onClick={() => {
                                            if (sourceTagSelected) {
                                                clearSource();
                                                return;
                                            }
                                            if (source) {
                                                if (sameSelection(source.selection, selection)) {
                                                    clearSource();
                                                    return;
                                                }
                                                toggleSelectionAssociation(source, tagEndpoint);
                                                clearSource();
                                                return;
                                            }
                                            setSource(tagEndpoint);
                                        }}
                                    >
                                        {tagText}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ))}
                {!items.length ? <div className="muted">No selected sub-prompts for the current image.</div> : null}
            </div>
        </div>
    );
}
