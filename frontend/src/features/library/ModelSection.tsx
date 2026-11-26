// The model of the generation: THE checkpoint picker (ModelPicker, also in the Create command bar's model popover) over
// the library store, and the Model section of the generation panel. Without any model the (disabled) picker comes with a
// call to action: add a checkpoint file from disk (desktop dialog) or browse the Models section. Adding files and
// folders otherwise lives in the panel's advanced options (ModelFileActions).
import {
	Button,
	Dropdown,
	Field,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	Option,
	tokens,
} from '@fluentui/react-components';
import { DocumentAdd20Regular, FolderAdd20Regular, Library20Regular } from '@fluentui/react-icons';
import { selectSelectedModel, useLibraryStore } from '../../stores/libraryStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { PaneSection } from '../../ui/PaneLayout';

const useStyles = makeStyles({
	dropdown: {
		minWidth: 0,
		width: '100%',
	},
	// The listbox is as wide as the field (long checkpoint names wrap inside it rather than widening it).
	listbox: {
		maxWidth: 'min(480px, 90vw)',
	},
	buttons: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	callToAction: {
		flexWrap: 'wrap',
		rowGap: tokens.spacingVerticalS,
	},
});

/** The Checkpoint picker (combobox 'Checkpoint'), disabled while the library has no model. */
export function ModelPicker(): JSX.Element {
	const styles = useStyles();
	const models = useLibraryStore((state) => state.models);
	const selectedModel = useLibraryStore(selectSelectedModel);
	const selectModel = useLibraryStore((state) => state.selectModel);
	const empty = models.length === 0;
	return (
		<Field label="Checkpoint">
			<Dropdown
				className={styles.dropdown}
				listbox={{ className: styles.listbox }}
				disabled={empty}
				placeholder={empty ? 'No model available' : 'Select a model'}
				value={selectedModel?.name ?? ''}
				selectedOptions={selectedModel ? [selectedModel.id] : []}
				onOptionSelect={(_event, data) => {
					if (data.optionValue) {
						selectModel(data.optionValue);
					}
				}}
			>
				{models.map((model) => (
					<Option key={model.id} value={model.id}>
						{model.name}
					</Option>
				))}
			</Dropdown>
		</Field>
	);
}

export type BrowseModelsButtonProps = {
	size?: 'small' | 'medium';
	appearance?: 'secondary' | 'subtle';
	/** Called once the Models section is shown (e.g. to close the popover holding the button). */
	onShown?: () => void;
};

/** 'Browse models': the hand-off to the Models section (find and download checkpoints and LoRAs). */
export function BrowseModelsButton({ size = 'medium', appearance = 'secondary', onShown }: BrowseModelsButtonProps): JSX.Element {
	const showSection = useNavigationStore((state) => state.showSection);
	return (
		<Button
			size={size}
			appearance={appearance}
			icon={<Library20Regular />}
			onClick={() => {
				showSection('models');
				onShown?.();
			}}
		>
			Browse models
		</Button>
	);
}

/** 'Add model file': a checkpoint file from disk, through the desktop file dialog (added and selected). */
export function AddModelFileButton({ appearance = 'secondary' }: { appearance?: 'primary' | 'secondary' }): JSX.Element {
	const addModelFile = useLibraryStore((state) => state.addModelFile);
	return (
		<Button appearance={appearance} icon={<DocumentAdd20Regular />} onClick={() => void addModelFile()}>
			Add model file
		</Button>
	);
}

/** Advanced options: add a model file or a Diffusers model folder from disk. */
export function ModelFileActions(): JSX.Element {
	const styles = useStyles();
	const addModelDirectory = useLibraryStore((state) => state.addModelDirectory);
	return (
		<div className={styles.buttons}>
			<AddModelFileButton />
			<Button icon={<FolderAdd20Regular />} onClick={() => void addModelDirectory()}>
				Add model folder
			</Button>
		</div>
	);
}

/** First run: no model yet. */
function NoModelCallToAction(): JSX.Element {
	const styles = useStyles();
	return (
		<MessageBar intent="info" layout="multiline" className={styles.callToAction}>
			<MessageBarBody>
				<MessageBarTitle>No model yet</MessageBarTitle>
				Pick a checkpoint file on this computer, or find and download one in Models.
			</MessageBarBody>
			<MessageBarActions>
				<AddModelFileButton appearance="primary" />
				<BrowseModelsButton />
			</MessageBarActions>
		</MessageBar>
	);
}

export function ModelSection(): JSX.Element {
	const hasModels = useLibraryStore((state) => state.models.length > 0);
	return (
		<PaneSection title="Model" actions={hasModels ? <BrowseModelsButton size="small" appearance="subtle" /> : undefined}>
			<ModelPicker />
			{hasModels ? null : <NoModelCallToAction />}
		</PaneSection>
	);
}
