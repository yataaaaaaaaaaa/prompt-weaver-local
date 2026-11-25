// Gallery of the characters store (useSortedCharacters): a spinner while the collection loads, the error with Retry
// (load), an empty state explaining the entry points, else one card per character (a list named 'Characters'; the
// columns are as wide as a card footer needs: Active switch, Edit and Delete on one row).
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
import { ArrowClockwiseRegular, PeopleRegular } from '@fluentui/react-icons';
import { useCharactersStore, useSortedCharacters } from '../../stores/charactersStore';
import { CharacterCard } from './CharacterCard';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	grid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fill, minmax(184px, 1fr))',
		gap: tokens.spacingHorizontalM,
		margin: 0,
		padding: tokens.spacingHorizontalXXS,
		listStyleType: 'none',
	},
	item: {
		minWidth: 0,
	},
	empty: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalS,
		paddingTop: tokens.spacingVerticalXL,
		paddingBottom: tokens.spacingVerticalXL,
		textAlign: 'center',
	},
	emptyIcon: {
		color: tokens.colorNeutralForeground4,
		fontSize: tokens.fontSizeHero800,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
		maxWidth: '48ch',
	},
});

function EmptyGallery(): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.empty}>
			<PeopleRegular className={styles.emptyIcon} aria-hidden />
			<Body1Strong>No characters yet</Body1Strong>
			<Body1 className={styles.muted}>
				Create one with New character, or with Create character in the Output browser (from the output shown) or in the
				Image library (from an image's details): its tags, LoRAs, seed and reference image are prefilled.
			</Body1>
		</div>
	);
}

export function CharacterGallery(): JSX.Element {
	const styles = useStyles();
	const characters = useSortedCharacters();
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
			) : loadStatus === 'ready' ? (
				<EmptyGallery />
			) : null}
		</div>
	);
}
