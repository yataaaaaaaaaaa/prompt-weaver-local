// The compact command bar at the top of the Create section (a Fluent Toolbar named SHELL_LABELS.createCommandBar): what
// the next generation uses, each one click from changing it.
// - Model: the selected checkpoint (or 'No model'); its popover holds THE checkpoint picker (ModelPicker), Add model file
//   and Browse models (the Models section).
// - Character: the active character (or 'No character'); its menu activates one (the active one checked), None
//   deactivates, New character opens the editor, Manage characters opens the Characters section.
// - LoRAs: how many are selected; its popover lists them with THE weight field (SelectedLoraWeights) and Edit LoRAs,
//   which expands the generation panel and scrolls its LoRA list into view.
// The bar stays on one row: long names are truncated, the full text is in the tooltips. Thin view over the library,
// characters, navigation and layout stores.
import {
	Button,
	makeStyles,
	Menu,
	MenuButton,
	MenuDivider,
	MenuGroup,
	MenuGroupHeader,
	MenuItem,
	MenuItemRadio,
	MenuList,
	MenuPopover,
	MenuTrigger,
	Popover,
	PopoverSurface,
	PopoverTrigger,
	Subtitle2,
	Toolbar,
	tokens,
	mergeClasses,
	Tooltip,
} from '@fluentui/react-components';
import { Cube20Regular, Edit20Regular, Layer20Regular, People20Regular, Person20Regular, PersonAdd20Regular } from '@fluentui/react-icons';
import { forwardRef, useState, type ReactElement, type ReactNode } from 'react';
import { SHELL_LABELS } from '../../app/sections';
import { selectActiveCharacter, useCharactersStore, useSortedCharacters } from '../../stores/charactersStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { selectSelectedLoraCount, selectSelectedModel, useLibraryStore } from '../../stores/libraryStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { LORA_LIST_ID } from '../library/LoraSection';
import { AddModelFileButton, BrowseModelsButton, ModelPicker } from '../library/ModelSection';
import { SelectedLoraWeights } from '../library/SelectedLoraWeights';

/** The menu radio value of "no active character". */
const NO_CHARACTER = '';

const useStyles = makeStyles({
	// The shell's Create header row draws the background and the bottom divider around the bar.
	bar: {
		flexWrap: 'nowrap',
		gap: tokens.spacingHorizontalXS,
		minWidth: 0,
		overflow: 'hidden',
		paddingLeft: tokens.spacingHorizontalS,
		paddingRight: tokens.spacingHorizontalS,
	},
	item: {
		minWidth: 0,
		maxWidth: '360px',
		flexShrink: 1,
		justifyContent: 'flex-start',
		fontWeight: tokens.fontWeightRegular,
	},
	value: {
		minWidth: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
	surface: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		width: '340px',
		maxWidth: '90vw',
		boxSizing: 'border-box',
	},
	title: {
		margin: 0,
	},
	buttons: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
});

type CommandButtonProps = {
	/** What the item is ('Model', 'Character', 'LoRAs'): the start of the accessible name. */
	kind: string;
	value: string;
	/** The value is a placeholder ('No model'): muted. */
	placeholder: boolean;
	icon: ReactElement;
	hint: string;
};

/** Text of a command bar item's accessible name and tooltip. */
function itemName(kind: string, value: string): string {
	return `${kind}: ${value}`;
}

/** The trigger of a command bar item: the kind icon, the (truncated) value and the chevron; the tooltip shows the full
 *  value and what a click does. The props and the ref of the Menu / Popover trigger are passed through to the button. */
const CommandButton = forwardRef<HTMLButtonElement, CommandButtonProps>(function CommandButton(
	{ kind, value, placeholder, icon, hint, ...triggerProps },
	ref,
) {
	const styles = useStyles();
	return (
		<Tooltip content={`${itemName(kind, value)}. ${hint}`} relationship="description" withArrow>
			<MenuButton {...triggerProps} ref={ref} appearance="subtle" className={styles.item} icon={icon} aria-label={itemName(kind, value)}>
				<span className={mergeClasses(styles.value, placeholder && styles.muted)}>{value}</span>
			</MenuButton>
		</Tooltip>
	);
});

/** A popover of the command bar: a title and its content; `open` is ephemeral view state. */
function CommandPopover({ trigger, title, children, open, onOpenChange }: {
	trigger: ReactElement;
	title: string;
	children: ReactNode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): JSX.Element {
	const styles = useStyles();
	return (
		<Popover open={open} onOpenChange={(_event, data) => onOpenChange(data.open)} positioning="below-start" withArrow trapFocus>
			<PopoverTrigger disableButtonEnhancement>{trigger}</PopoverTrigger>
			<PopoverSurface className={styles.surface} aria-label={title}>
				<Subtitle2 as="h2" className={styles.title}>
					{title}
				</Subtitle2>
				{children}
			</PopoverSurface>
		</Popover>
	);
}

/** The content of the model popover; `onDone` closes it (after Browse models). */
export function ModelCommandContent({ onDone }: { onDone: () => void }): JSX.Element {
	const styles = useStyles();
	return (
		<>
			<ModelPicker />
			<div className={styles.buttons}>
				<AddModelFileButton />
				<BrowseModelsButton onShown={onDone} />
			</div>
		</>
	);
}

function ModelCommand(): JSX.Element {
	const model = useLibraryStore(selectSelectedModel);
	const [open, setOpen] = useState(false);
	return (
		<CommandPopover
			title="Model"
			open={open}
			onOpenChange={setOpen}
			trigger={
				<CommandButton
					kind="Model"
					value={model?.name ?? 'No model'}
					placeholder={model === null}
					icon={<Cube20Regular />}
					hint="Change the checkpoint, add one from disk or browse Models."
				/>
			}
		>
			<ModelCommandContent onDone={() => setOpen(false)} />
		</CommandPopover>
	);
}

function CharacterCommand(): JSX.Element {
	const active = useCharactersStore(selectActiveCharacter);
	const characters = useSortedCharacters();
	const setActive = useCharactersStore((state) => state.setActive);
	const startCreate = useCharactersStore((state) => state.startCreate);
	const showSection = useNavigationStore((state) => state.showSection);
	return (
		<Menu
			checkedValues={{ character: [active?.id ?? NO_CHARACTER] }}
			onCheckedValueChange={(_event, data) => {
				const characterId = data.checkedItems[0] ?? NO_CHARACTER;
				void setActive(characterId === NO_CHARACTER ? null : characterId);
			}}
			positioning="below-start"
		>
			<MenuTrigger disableButtonEnhancement>
				<CommandButton
					kind="Character"
					value={active?.name ?? 'No character'}
					placeholder={active === null}
					icon={<Person20Regular />}
					hint="Activate a character to keep the same person across generations."
				/>
			</MenuTrigger>
			<MenuPopover>
				<MenuList>
					<MenuGroup>
						<MenuGroupHeader>Active character</MenuGroupHeader>
						<MenuItemRadio name="character" value={NO_CHARACTER}>
							None
						</MenuItemRadio>
						{characters.map((character) => (
							<MenuItemRadio key={character.id} name="character" value={character.id}>
								{character.name}
							</MenuItemRadio>
						))}
					</MenuGroup>
					<MenuDivider />
					<MenuItem icon={<PersonAdd20Regular />} onClick={() => startCreate()}>
						New character
					</MenuItem>
					<MenuItem icon={<People20Regular />} onClick={() => showSection('characters')}>
						Manage characters
					</MenuItem>
				</MenuList>
			</MenuPopover>
		</Menu>
	);
}

/** 'No LoRAs', '1 LoRA', '3 LoRAs'. */
export function loraCountText(count: number): string {
	if (count === 0) {
		return 'No LoRAs';
	}
	return count === 1 ? '1 LoRA' : `${count} LoRAs`;
}

/** The content of the LoRA popover; `onDone` closes it (Edit LoRAs). */
export function LoraCommandContent({ onDone }: { onDone: () => void }): JSX.Element {
	const setRegionCollapsed = useLayoutStore((state) => state.setRegionCollapsed);
	const editLoras = () => {
		onDone();
		setRegionCollapsed('generation', false);
		// The LoRA list of the (now expanded) generation panel: scrolled into view once it is rendered.
		requestAnimationFrame(() => document.getElementById(LORA_LIST_ID)?.scrollIntoView({ block: 'nearest' }));
	};
	return (
		<>
			<SelectedLoraWeights />
			<div>
				<Button icon={<Edit20Regular />} onClick={editLoras}>
					Edit LoRAs
				</Button>
			</div>
		</>
	);
}

function LoraCommand(): JSX.Element {
	const count = useLibraryStore(selectSelectedLoraCount);
	const [open, setOpen] = useState(false);
	return (
		<CommandPopover
			title="LoRAs"
			open={open}
			onOpenChange={setOpen}
			trigger={
				<CommandButton
					kind="LoRAs"
					value={loraCountText(count)}
					placeholder={count === 0}
					icon={<Layer20Regular />}
					hint="Adjust the weights of the selected LoRAs."
				/>
			}
		>
			<LoraCommandContent onDone={() => setOpen(false)} />
		</CommandPopover>
	);
}

export function CreateCommandBar(): JSX.Element {
	const styles = useStyles();
	return (
		<Toolbar aria-label={SHELL_LABELS.createCommandBar} className={styles.bar}>
			<ModelCommand />
			<CharacterCommand />
			<LoraCommand />
		</Toolbar>
	);
}
