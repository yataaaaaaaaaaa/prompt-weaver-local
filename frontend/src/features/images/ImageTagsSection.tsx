// Tags of the image in the detail view (useImageTags: its prompt split into tags, LoRA tags removed) as selectable
// Fluent tags, and the 'Add to category' menu: every category plus 'New category'; the store's addTagsToCategory adds
// them as one new sub-prompt. The picked subset is ephemeral view state (none picked = every tag).
import {
	Body1,
	Caption1,
	InteractionTag,
	InteractionTagPrimary,
	makeStyles,
	Menu,
	MenuButton,
	MenuDivider,
	MenuItem,
	MenuList,
	MenuPopover,
	MenuTrigger,
	TagGroup,
	tokens,
} from '@fluentui/react-components';
import { AddRegular, TextAddRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { categoryKeyOf, type CategoryKey } from '../../domain/categories';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useImageLibraryStore, useImageTags } from '../../stores/imageLibraryStore';
import { PaneSection } from '../../ui/PaneLayout';

const useStyles = makeStyles({
	tags: {
		display: 'flex',
		flexWrap: 'wrap',
		rowGap: tokens.spacingVerticalXS,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

/** One menu item per category (subscribes to the categories only while the menu is open). */
function CategoryMenuItems({ onPick }: { onPick: (key: CategoryKey) => void }): JSX.Element {
	const categories = useCategoriesStore((state) => state.categories);
	return (
		<>
			{categories.map((category) => {
				const key = categoryKeyOf(category.text);
				return (
					<MenuItem key={key} onClick={() => onPick(key)}>
						{category.text || 'Unnamed category'}
					</MenuItem>
				);
			})}
		</>
	);
}

function AddTagsMenu({ imageKey, tags, disabled }: { imageKey: string; tags: readonly string[]; disabled: boolean }): JSX.Element {
	const addTagsToCategory = useImageLibraryStore((state) => state.addTagsToCategory);
	// Without a picked subset every tag is added (the store's default).
	const add = (target: CategoryKey | null) => addTagsToCategory(imageKey, target, tags.length > 0 ? tags : undefined);
	return (
		<Menu>
			<MenuTrigger disableButtonEnhancement>
				<MenuButton appearance="subtle" size="small" icon={<TextAddRegular />} disabled={disabled}>
					{tags.length > 0 ? `Add ${tags.length} to category` : 'Add to category'}
				</MenuButton>
			</MenuTrigger>
			<MenuPopover>
				<MenuList>
					<CategoryMenuItems onPick={add} />
					<MenuDivider />
					<MenuItem icon={<AddRegular />} onClick={() => add(null)}>
						New category
					</MenuItem>
				</MenuList>
			</MenuPopover>
		</Menu>
	);
}

export function ImageTagsSection({ imageKey }: { imageKey: string }): JSX.Element {
	const styles = useStyles();
	const tags = useImageTags(imageKey);
	const [picked, setPicked] = useState<string[]>([]);
	// Picked tags in prompt order (a tag no longer listed is dropped).
	const pickedTags = tags.filter((tag) => picked.includes(tag));

	return (
		<PaneSection title="Tags" actions={<AddTagsMenu imageKey={imageKey} tags={pickedTags} disabled={tags.length === 0} />}>
			{tags.length > 0 ? (
				<>
					<TagGroup
						className={styles.tags}
						aria-label="Tags"
						size="small"
						selectedValues={pickedTags}
						onTagSelect={(_event, data) =>
							setPicked((current) => (current.includes(data.value) ? current.filter((tag) => tag !== data.value) : [...current, data.value]))
						}
					>
						{tags.map((tag) => (
							<InteractionTag key={tag} value={tag}>
								<InteractionTagPrimary>{tag}</InteractionTagPrimary>
							</InteractionTag>
						))}
					</TagGroup>
					<Caption1 className={styles.muted}>Select tags to add only those; with none selected, every tag is added.</Caption1>
				</>
			) : (
				<Body1 className={styles.muted}>This image publishes no prompt tags.</Body1>
			)}
		</PaneSection>
	);
}
