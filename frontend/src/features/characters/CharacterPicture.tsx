// The picture of a character in a 3:4 frame: its thumbnail (characterImageUrl, anchored at the top: faces stay in
// view), or a placeholder (a person icon centered in the frame, named for assistive technology). The frame takes the
// width its container gives (`className` sizes it). Phrasing content only (spans), so it can sit inside a button.
// Shared by the gallery cards and the character details.
import { Image, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { PersonRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { characterImageUrl } from '../../api/config';
import type { Character } from '../../api/types';

const useStyles = makeStyles({
	frame: {
		position: 'relative',
		display: 'block',
		aspectRatio: '3 / 4',
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground3,
	},
	fill: {
		position: 'absolute',
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		width: '100%',
		height: '100%',
	},
	image: {
		objectPosition: 'top',
	},
	placeholder: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		color: tokens.colorNeutralForeground3,
		fontSize: tokens.fontSizeHero900,
	},
});

export type CharacterPictureProps = {
	character: Pick<Character, 'id' | 'name' | 'thumbnail'>;
	className?: string;
	/** Drawn over the picture (e.g. a badge), positioned by the caller. */
	children?: ReactNode;
};

export function CharacterPicture({ character, className, children }: CharacterPictureProps): JSX.Element {
	const styles = useStyles();
	return (
		<span className={mergeClasses(styles.frame, className)}>
			{character.thumbnail ? (
				<Image
					className={mergeClasses(styles.fill, styles.image)}
					src={characterImageUrl(character.id, character.thumbnail.id)}
					alt={`Thumbnail of ${character.name}`}
					fit="cover"
					loading="lazy"
				/>
			) : (
				<span className={mergeClasses(styles.fill, styles.placeholder)} role="img" aria-label={`No thumbnail for ${character.name}`}>
					<PersonRegular aria-hidden />
				</span>
			)}
			{children}
		</span>
	);
}
