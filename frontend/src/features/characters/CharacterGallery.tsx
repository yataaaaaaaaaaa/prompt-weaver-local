// The results of the Characters section: the characters the search shows (useGalleryCharacters), one card each in a
// responsive grid (a list named 'Characters'; the columns are as wide as a card footer needs: Active switch, Edit and
// Delete on one row). A spinner while the collection loads, the error with Retry (load), an empty state explaining
// the three ways to create a character (New character; Create character from an output in Create; from an image in
// Images, each one click away), and, when the search matches nothing, what was searched with Clear search.
import {
	Body1,
	Body1Strong,
	Button,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	Spinner,
	tokens,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, ArrowRightRegular, DismissRegular, PeopleRegular, SearchRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { useCharactersStore, useGalleryCharacters } from '../../stores/charactersStore';
import { goToSectionAction, useNavigationStore } from '../../stores/navigationStore';
import { EmptyState } from '../../ui/EmptyState';
import { CharacterCard } from './CharacterCard';
import { NewCharacterButton } from './NewCharacterButton';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	grid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))',
		gap: tokens.spacingHorizontalM,
		margin: 0,
		// Room for the selected card's frame (an outline drawn outside the card).
		padding: tokens.spacingHorizontalXXS,
		listStyleType: 'none',
	},
	item: {
		minWidth: 0,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
		maxWidth: '56ch',
	},
	ways: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		width: 'min(100%, 560px)',
		margin: 0,
		marginTop: tokens.spacingVerticalS,
		padding: 0,
		listStyleType: 'none',
		textAlign: 'left',
	},
	way: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalM,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		paddingLeft: tokens.spacingHorizontalM,
		paddingRight: tokens.spacingHorizontalM,
		borderRadius: tokens.borderRadiusMedium,
		backgroundColor: tokens.colorNeutralBackground1,
		boxShadow: tokens.shadow2,
	},
	wayText: {
		display: 'flex',
		flexDirection: 'column',
		flex: '1 1 240px',
		minWidth: 0,
	},
});

function Way({ title, text, action }: { title: string; text: string; action: ReactNode }): JSX.Element {
	const styles = useStyles();
	return (
		<li className={styles.way}>
			<span className={styles.wayText}>
				<Body1Strong>{title}</Body1Strong>
				<Body1 className={styles.muted}>{text}</Body1>
			</span>
			{action}
		</li>
	);
}

function EmptyGallery(): JSX.Element {
	const styles = useStyles();
	const showSection = useNavigationStore((state) => state.showSection);
	// The one 'Go to <section>' wording and action of the hand-offs.
	const goToCreate = goToSectionAction('create');
	return (
		<EmptyState
			icon={PeopleRegular}
			title="No characters yet"
			actions={
				<ul className={styles.ways} aria-label="Ways to create a character">
					<Way title="From scratch" text="Write its tags, pick its LoRAs and seed." action={<NewCharacterButton />} />
					<Way
						title="From an output you like"
						text="In Create, show the output, then choose Create character: its tags, LoRAs, seed and picture are prefilled."
						action={
							<Button icon={<ArrowRightRegular />} iconPosition="after" onClick={goToCreate.run}>
								{goToCreate.label}
							</Button>
						}
					/>
					<Way
						title="From an online image"
						text="In Images, open an image, then choose Create character: its tags, LoRAs, seed and picture are prefilled."
						action={
							<Button icon={<ArrowRightRegular />} iconPosition="after" onClick={() => showSection('images')}>
								Browse images
							</Button>
						}
					/>
				</ul>
			}
		>
			A character keeps the same person across generations: while it is active, its tags, LoRAs, seed and reference images
			apply. Create one in any of these ways:
		</EmptyState>
	);
}

function NoMatch({ query }: { query: string }): JSX.Element {
	const setQuery = useCharactersStore((state) => state.setQuery);
	return (
		<EmptyState
			icon={SearchRegular}
			title={`No character matches “${query.trim()}”`}
			actions={
				<Button icon={<DismissRegular />} onClick={() => setQuery('')}>
					Clear search
				</Button>
			}
		>
			The search looks in the names, identity tags and outfit tags; separate several terms with commas.
		</EmptyState>
	);
}

export function CharacterGallery(): JSX.Element {
	const styles = useStyles();
	const characters = useGalleryCharacters();
	const total = useCharactersStore((state) => state.characters.length);
	const query = useCharactersStore((state) => state.query);
	const loadStatus = useCharactersStore((state) => state.loadStatus);
	const loadError = useCharactersStore((state) => state.loadError);
	const load = useCharactersStore((state) => state.load);
	const loading = loadStatus === 'loading' || loadStatus === 'idle';

	return (
		<div className={styles.root} aria-busy={loading}>
			{loading ? <Spinner size="small" label="Loading characters…" /> : null}
			{loadStatus === 'failed' ? (
				<MessageBar intent="error" layout="multiline">
					<MessageBarBody>
						<MessageBarTitle>Could not load the characters</MessageBarTitle>
						{loadError}
					</MessageBarBody>
					<MessageBarActions>
						<Button size="small" icon={<ArrowClockwiseRegular />} onClick={() => void load()}>
							Retry
						</Button>
					</MessageBarActions>
				</MessageBar>
			) : null}
			{characters.length > 0 ? (
				<ul className={styles.grid} aria-label="Characters">
					{characters.map((character) => (
						<li key={character.id} className={styles.item}>
							<CharacterCard character={character} />
						</li>
					))}
				</ul>
			) : total > 0 ? (
				<NoMatch query={query} />
			) : loadStatus === 'ready' ? (
				<EmptyGallery />
			) : null}
		</div>
	);
}
