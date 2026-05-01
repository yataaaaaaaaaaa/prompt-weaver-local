import { useSubPromptItem } from "../stores/categoriesStore";
import { useIsCurrentImageSelected } from "../stores/currentImageStore";
import { CategoryId } from "../utils/CategoryId";
import { SubPromptId } from "../utils/SubPromptId";
import EditableOnDemandText, { EditableDisplayProps } from "./EditableOnDemandText";

function LockedIcon() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M4.5 6V4.75a3.5 3.5 0 1 1 7 0V6h.75A1.75 1.75 0 0 1 14 7.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5A1.75 1.75 0 0 1 3.75 6zm1.5 0H10V4.75a2 2 0 1 0-4 0z" />
        </svg>
    );
}

function UnlockedIcon() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M10 6V4.75a2 2 0 0 0-3.84-.77.75.75 0 0 1-1.39-.56A3.5 3.5 0 0 1 11.5 4.75V6h.75A1.75 1.75 0 0 1 14 7.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5A1.75 1.75 0 0 1 3.75 6zm2.5 1.5h-9a.25.25 0 0 0-.25.25v5.5c0 .14.11.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25" />
        </svg>
    );
}

function Preview(props: EditableDisplayProps): JSX.Element {
    return <div className="prompt-chip whitespace-pre-wrap">{props.text || 'Click to edit'}</div>;
}


export type SubPromptCardProps = {
    categoryId: CategoryId;
    id: SubPromptId;
};


export default function SubPromptCard({ categoryId, id, }: SubPromptCardProps) {
    const { text, state, onTextChange, onStateChange, onRemove } =
        useSubPromptItem(categoryId, id);

    const isSelected = useIsCurrentImageSelected(categoryId, new SubPromptId(text));

    let className = '';
    if (isSelected) {
        className = "focused-row"
    }
    if (state === 'skip') {
        className += " skipped-row"
    }
    if (state == 'indirectly-disabled') {
        className += " associated-row"
    }

    return (
        <div className={["prompt-row", className].filter(Boolean).join(' ')}>
            <EditableOnDemandText
                className="prompt-chip-shell"
                displayClassName="buffered-clickable-fill-shell"
                textareaClassName="prompt-editor"
                text={text}
                DisplayComponent={Preview}
                onExit={onTextChange}
                commitOnPlainEnter={true}
            />
            <button
                className={state === 'skip' ? 'warning-button compact-icon-button' : 'ghost-button compact-icon-button'}
                title={state === 'skip' ? 'Unskip sub-prompt' : 'Skip sub-prompt'}
                onClick={() => onStateChange(state === 'skip' ? 'normal' : 'skip')}
            >
                ⊘
            </button>
            <button
                className={state === 'lock' ? 'lock-button active-lock compact-icon-button' : 'lock-button compact-icon-button'}
                title={state === 'lock' ? 'Unlock sub-prompt' : 'Lock sub-prompt'}
                aria-label={state === 'lock' ? 'Unlock sub-prompt' : 'Lock sub-prompt'}
                onClick={() => onStateChange(state === 'lock' ? 'normal' : 'lock')}
            >
                {state === 'lock' ? <LockedIcon /> : <UnlockedIcon />}
            </button>
            <button
                className="danger-button compact-icon-button icon-delete-button"
                title="Delete sub-prompt"
                onClick={onRemove}
            >
                ×
            </button>
        </div>);
}

