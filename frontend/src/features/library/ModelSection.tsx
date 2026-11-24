// Model picker of the library store (Dropdown) + desktop dialogs to add a model file or a Diffusers folder.
import { Button, Dropdown, Field, makeStyles, Option, tokens } from '@fluentui/react-components';
import { DocumentAdd20Regular, FolderAdd20Regular } from '@fluentui/react-icons';
import { selectSelectedModel, useLibraryStore } from '../../stores/libraryStore';
import { PaneSection } from '../../ui/PaneLayout';

const useStyles = makeStyles({
	dropdown: {
		minWidth: 0,
		width: '100%',
	},
	buttons: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
});

export function ModelSection(): JSX.Element {
	const styles = useStyles();
	const models = useLibraryStore((state) => state.models);
	const selectedModel = useLibraryStore(selectSelectedModel);
	const selectModel = useLibraryStore((state) => state.selectModel);
	const addModelFile = useLibraryStore((state) => state.addModelFile);
	const addModelDirectory = useLibraryStore((state) => state.addModelDirectory);
	const empty = models.length === 0;

	return (
		<PaneSection title="Model">
			<Field label="Checkpoint">
				<Dropdown
					className={styles.dropdown}
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
			<div className={styles.buttons}>
				<Button icon={<DocumentAdd20Regular />} onClick={() => void addModelFile()}>
					Add model file
				</Button>
				<Button icon={<FolderAdd20Regular />} onClick={() => void addModelDirectory()}>
					Add model folder
				</Button>
			</div>
		</PaneSection>
	);
}
