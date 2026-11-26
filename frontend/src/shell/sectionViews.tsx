// The view of every task section (ids and names: src/app/sections.ts): its rail icon and its component. The ONE place
// where section views are declared; the shell renders the rail and the section <main> from it.
import type { FluentIcon } from '@fluentui/react-icons';
import {
	bundleIcon,
	ImageSearchFilled,
	ImageSearchRegular,
	LibraryFilled,
	LibraryRegular,
	PeopleFilled,
	PeopleRegular,
	SparkleFilled,
	SparkleRegular,
} from '@fluentui/react-icons';
import type { ComponentType } from 'react';
import type { SectionId } from '../app/sections';
import { CharactersSection } from '../features/characters/CharactersSection';
import { ImagesSection } from '../features/images/ImagesSection';
import { ModelsSection } from '../features/models/ModelsSection';
import { CreateSection } from './CreateSection';

export type SectionView = {
	/** Unsized Fluent icon (sizes itself to its slot): regular, filled while the section is shown (Fluent Nav). */
	icon: FluentIcon;
	component: ComponentType;
};

export const SECTION_VIEWS: Readonly<Record<SectionId, SectionView>> = {
	create: { icon: bundleIcon(SparkleFilled, SparkleRegular), component: CreateSection },
	models: { icon: bundleIcon(LibraryFilled, LibraryRegular), component: ModelsSection },
	images: { icon: bundleIcon(ImageSearchFilled, ImageSearchRegular), component: ImagesSection },
	characters: { icon: bundleIcon(PeopleFilled, PeopleRegular), component: CharactersSection },
};
