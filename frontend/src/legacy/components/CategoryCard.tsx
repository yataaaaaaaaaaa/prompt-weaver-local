import { ChangeEvent, useEffect, useState } from "react";
import { splitBulkPrompts } from "../app/appHelpers";
import { useCategoryItem } from "../stores/categoriesStore";
import { useWorkspaceZIndexStore } from "../stores/workspaceZIndex";
import { CategoryId } from "../utils/CategoryId";
import EditableOnDemandText, { EditableDisplayProps } from "./EditableOnDemandText";
import FloatingPane from "./FloatingPane";
import SubPromptCardList from "./SubPromptCardList";

export type CategoryCardProps = {
	categoryId: CategoryId;
};

function Preview(props: EditableDisplayProps): JSX.Element {
	return <div className="whitespace-pre-wrap">{props.text || 'Click to edit'}</div>;
}

function CategoryCard({ categoryId }: CategoryCardProps) {
	const id = categoryId.toString();
	const {
		text,
		activation_text,
		priority,
		state,
		subPrompts,
		onTextChange,
		onActivationTextChange,
		onPriorityChange,
		onAddSubPrompt,
		onStateChange,
		onRemove,
		onSetSubPrompts,
	} = useCategoryItem(categoryId);
	const { setCategoryZIndex, clearCategory } = useWorkspaceZIndexStore();
	const [isBulkEditing, setIsBulkEditing] = useState<boolean>(false);
	const [bulkEditValue, setBulkEditValue] = useState<string>('');
	const [priorityValue, setPriorityValue] = useState<string>('' + priority);
	const [nameEditToken, setNameEditToken] = useState<number | null>(null);
	const [conditionEditToken, setConditionEditToken] = useState<number | null>(null);

	useEffect(() => {
		if (!isBulkEditing) {
			setBulkEditValue(subPrompts.map((subPrompt) => subPrompt.text).join('\n|\n'));
		}
	}, [isBulkEditing, subPrompts]);

	useEffect(() => {
		setPriorityValue(String(priority));
	}, [priority]);

	let className = 'category-card';
	if (state === 'skip') {
		className += ' muted-card';
	} else if (state === 'indirectly-disabled') {
		className += ' indirectly-disabled-card';
	}

	const onBulkEdit = (value: string) => {
		setIsBulkEditing(false);
		onSetSubPrompts(splitBulkPrompts(value));
	};

	const handleBulkEditingBlur = () => {
		onBulkEdit(bulkEditValue);
	};

	const handleBulkEditingKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			setBulkEditValue(subPrompts.map((subPrompt) => subPrompt.text).join('\n|\n'));
			setIsBulkEditing(false);
			return;
		}

		if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) {
			return;
		}

		event.preventDefault();
		onBulkEdit(bulkEditValue);
	};

	return (
		<FloatingPane
			identifier={id}
			defaultLayout={{ x: 40, y: 40, width: 500, height: 300 }}
			className={className}
			kind="category"
		>
			{({ rename, remove, zIndex }) => (
				<>
					<div className="category-header">
						<div className="category-main">
							<div className="category-edit-row">
								<button
									type="button"
									className="icon-button category-edit-trigger"
									title="Rename category"
									onClick={() => setNameEditToken((value) => (value ?? 0) + 1)}
								>
									✎
								</button>
								<EditableOnDemandText
									text={text}
									DisplayComponent={Preview}
									disabled={true}
									editToken={nameEditToken ?? undefined}
									onExit={(value) => {
										const newId = CategoryId.from(value).toString();
										rename(newId);
										setCategoryZIndex(newId, zIndex);
										if (newId !== id) {
											clearCategory(id);
										}
										onTextChange(value);
									}}
									commitOnPlainEnter={true}
								/>
							</div>

							<div className="category-edit-row">
								<button
									type="button"
									className="icon-button category-edit-trigger"
									title="Edit category condition"
									onClick={() => setConditionEditToken((value) => (value ?? 0) + 1)}
								>
									✎
								</button>
								<EditableOnDemandText
									text={activation_text}
									DisplayComponent={Preview}
									disabled={true}
									editToken={conditionEditToken ?? undefined}
									onExit={(value) => {
										onActivationTextChange(value);
									}}
									commitOnPlainEnter={true}
								/>
							</div>
						</div>

						<div className="category-actions">
							<input
								type="text"
								className="floating-priority-input"
								value={priorityValue}
								onChange={(event: ChangeEvent<HTMLInputElement>) => {
									setPriorityValue(event.target.value)
									const res = parseFloat(event.target.value)
									if (!isNaN(res)) {
										onPriorityChange(res)
									}
								}}
							/>
							<button
								type="button"
								className="icon-button"
								title="Edit all sub-prompts"
								onClick={() => {
									setBulkEditValue(subPrompts.map((subPrompt) => subPrompt.text).join('\n|\n'));
									setIsBulkEditing(true);
								}}
							>
								≡
							</button>
							<button type="button" className="icon-button" title="Add sub-prompt" onClick={() => onAddSubPrompt({ text: '', state: 'normal', extraLoraIds: [] })}>
								+
							</button>
							<button
								type="button"
								className={state === 'skip' ? 'warning-button compact-icon-button' : 'ghost-button compact-icon-button'}
								title={state === 'skip' ? 'Unskip category' : 'Skip category'}
								onClick={() => onStateChange(state === 'skip' ? 'normal' : 'skip')}
							>
								⊘
							</button>
							<button
								type="button"
								className="danger-button compact-icon-button icon-delete-button"
								title="Delete category"
								onClick={() => {
									if (!window.confirm(`Delete category '${text || '(unnamed category)'}'?`)) {
										return;
									}
									clearCategory(id);
									onRemove();
									remove();
								}}
							>
								×
							</button>
						</div>
					</div>
					{isBulkEditing && (
						<textarea
							value={bulkEditValue}
							rows={Math.max(4, subPrompts.length * 2)}
							onChange={(event) => setBulkEditValue(event.target.value)}
							onKeyDown={handleBulkEditingKeyDown}
							onBlur={handleBulkEditingBlur}
							autoFocus
						/>
					)}
					{!isBulkEditing && <SubPromptCardList categoryId={categoryId}></SubPromptCardList>}
				</>
			)}
		</FloatingPane>
	);
}

export default CategoryCard;
