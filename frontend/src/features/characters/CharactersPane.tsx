// Characters pane: the character editor while it is open (characters store `editor`), the gallery of characters with
// New character (startCreate), and the reference images section (IP-Adapter support and files). Thin composition of
// views over src/stores/charactersStore.ts and src/stores/ipAdapterStore.ts. The window is titled 'Characters': the
// gallery section is 'Character gallery', so no heading or region inside repeats the window's name.
import { Button, useRestoreFocusTarget } from '@fluentui/react-components';
import { PersonAddRegular } from '@fluentui/react-icons';
import { useCharactersStore } from '../../stores/charactersStore';
import { PaneContent, PaneSection } from '../../ui/PaneLayout';
import { CharacterEditor } from './CharacterEditor';
import { CharacterGallery } from './CharacterGallery';
import { IpAdapterSection } from './IpAdapterSection';

export function CharactersPane(): JSX.Element {
	const editorOpen = useCharactersStore((state) => state.editor !== null);
	// Remounted per edited character, so the name field takes the focus again.
	const editorKey = useCharactersStore((state) => state.editor?.characterId ?? 'new');
	const startCreate = useCharactersStore((state) => state.startCreate);
	// The focus comes back here when the editor it opened closes.
	const restoreFocusTarget = useRestoreFocusTarget();
	return (
		<PaneContent>
			{editorOpen ? <CharacterEditor key={editorKey} /> : null}
			<PaneSection
				title="Character gallery"
				actions={
					<Button appearance="subtle" icon={<PersonAddRegular />} onClick={() => startCreate()} {...restoreFocusTarget}>
						New character
					</Button>
				}
			>
				<CharacterGallery />
			</PaneSection>
			<IpAdapterSection />
		</PaneContent>
	);
}
