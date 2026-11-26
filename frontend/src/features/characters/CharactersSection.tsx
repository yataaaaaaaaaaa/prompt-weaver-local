// The Characters section (navigation rail): keep the same character across generations. Full page on the shared
// SectionLayout:
// - toolbar: the gallery search ('Search characters', name and tags; Ctrl+F focuses it: SECTION_SEARCH_ATTRIBUTE)
//   with the count it shows, and New character (the section's primary action);
// - results ('Character gallery'): CharacterGallery;
// - detail panel ('Character details'): the editor while it is open (new, edit, or prefilled from an output or an
//   image), else the selected character's details, else a prompt to select one; then, always, the 'Reference images
//   (IP-Adapter)' section (the support of the selected model). The details stay mounted (hidden) while the editor is
//   open, so the focus can return to their Edit button.
// The keyboard focus (the editor's name field when it opens, back to what opened it when it closes, a fallback after a
// deletion) is useCharactersSectionFocus.
// Thin views over the characters store and the IP-Adapter store.
import { Caption1, makeStyles, SearchBox, tokens } from '@fluentui/react-components';
import { PersonSearchRegular } from '@fluentui/react-icons';
import { useRef } from 'react';
import { SECTION_SEARCH_ATTRIBUTE } from '../../app/sections';
import { selectSelectedCharacter, useCharactersStore, useGalleryCharacters } from '../../stores/charactersStore';
import { EmptyState } from '../../ui/EmptyState';
import { PaneContent } from '../../ui/PaneLayout';
import { SectionLayout } from '../../ui/SectionLayout';
import { CharacterDetails } from './CharacterDetails';
import { CharacterEditor } from './CharacterEditor';
import { CharacterGallery } from './CharacterGallery';
import { IpAdapterSection } from './IpAdapterSection';
import { NewCharacterButton } from './NewCharacterButton';
import { useCharactersSectionFocus } from './useCharactersSectionFocus';

const useStyles = makeStyles({
	// No box of its own: the layout fills the section.
	root: {
		display: 'contents',
	},
	search: {
		flex: '0 1 320px',
		minWidth: '200px',
	},
	count: {
		color: tokens.colorNeutralForeground3,
		whiteSpace: 'nowrap',
	},
	newCharacter: {
		marginLeft: 'auto',
	},
});

function CharactersToolbar(): JSX.Element {
	const styles = useStyles();
	const query = useCharactersStore((state) => state.query);
	const setQuery = useCharactersStore((state) => state.setQuery);
	const total = useCharactersStore((state) => state.characters.length);
	const loaded = useCharactersStore((state) => state.loadStatus === 'ready');
	const shown = useGalleryCharacters().length;
	const searching = query.trim() !== '';
	return (
		<>
			<SearchBox
				className={styles.search}
				aria-label="Search characters"
				placeholder="Search by name or tag"
				value={query}
				onChange={(_event, data) => setQuery(data.value)}
				{...{ [SECTION_SEARCH_ATTRIBUTE]: '' }}
			/>
			{/* Counted once the collection is loaded (the gallery shows the spinner or the error before). */}
			<Caption1 className={styles.count} role="status">
				{!loaded ? '' : searching ? `${shown} of ${total} characters` : `${total} ${total === 1 ? 'character' : 'characters'}`}
			</Caption1>
			<NewCharacterButton appearance="primary" className={styles.newCharacter} focus="new" />
		</>
	);
}

/** What the detail panel shows while nothing is selected and the editor is closed. */
function NoSelection(): JSX.Element {
	const hasCharacters = useCharactersStore((state) => state.characters.length > 0);
	return (
		<EmptyState icon={PersonSearchRegular} title={hasCharacters ? 'No character selected' : 'No character yet'}>
			{hasCharacters
				? 'Select a character in the gallery to see its tags, LoRAs, seed and reference images.'
				: 'The details of a character show here once it is created.'}
		</EmptyState>
	);
}

function CharacterDetailPanel(): JSX.Element {
	const session = useCharactersStore((state) => state.editor?.session ?? null);
	const selected = useCharactersStore(selectSelectedCharacter);
	// Nothing to say about the selection until the collection is known (the gallery shows the spinner or the error).
	const known = useCharactersStore((state) => state.loadStatus === 'ready' || state.characters.length > 0);
	const editing = session !== null;
	return (
		<PaneContent>
			{/* Remounted for each opening, so the form starts fresh and its name field takes the focus. */}
			{editing ? <CharacterEditor key={session} /> : null}
			{selected || known ? <div hidden={editing}>{selected ? <CharacterDetails character={selected} /> : <NoSelection />}</div> : null}
			<IpAdapterSection />
		</PaneContent>
	);
}

export function CharactersSection(): JSX.Element {
	const styles = useStyles();
	const rootRef = useRef<HTMLDivElement>(null);
	useCharactersSectionFocus(rootRef);
	return (
		<div ref={rootRef} className={styles.root}>
			<SectionLayout
				title="Characters"
				toolbar={<CharactersToolbar />}
				results={<CharacterGallery />}
				resultsLabel="Character gallery"
				detail={<CharacterDetailPanel />}
				detailLabel="Character details"
			/>
		</div>
	);
}
