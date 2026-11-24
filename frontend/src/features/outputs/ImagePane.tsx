// Shows the output being viewed (outputs store), scaled to fit the pane.
import { Body1, Image, makeStyles, tokens } from '@fluentui/react-components';
import { ImageOffRegular } from '@fluentui/react-icons';
import { selectCurrentImageUrl, useOutputsStore } from '../../stores/outputsStore';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		height: '100%',
		padding: tokens.spacingHorizontalS,
	},
	empty: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalS,
		color: tokens.colorNeutralForeground3,
	},
	emptyIcon: {
		fontSize: tokens.fontSizeHero800,
	},
});

export function ImagePane(): JSX.Element {
	const styles = useStyles();
	const imageUrl = useOutputsStore(selectCurrentImageUrl);
	const currentId = useOutputsStore((state) => state.currentId);
	return (
		<div className={styles.root}>
			{imageUrl ? (
				<Image src={imageUrl} alt={`Output ${currentId}`} fit="contain" />
			) : (
				<div className={styles.empty}>
					<ImageOffRegular aria-hidden className={styles.emptyIcon} />
					<Body1>No image selected.</Body1>
				</div>
			)}
		</div>
	);
}
