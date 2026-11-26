// The look of the navigation rail (src/shell/NavRail.tsx): a narrow Fluent 2 Nav rail whose items stack their icon
// above a caption, and whose bottom buttons (downloads, about) look the same. One owner of the rail's metrics.
import { makeStyles, tokens, typographyStyles } from '@fluentui/react-components';

/** Width of the rail: room for the longest caption ('Characters') under a 24 px icon. */
export const RAIL_WIDTH = '80px';

export const useRailStyles = makeStyles({
	rail: {
		width: RAIL_WIDTH,
		minWidth: RAIL_WIDTH,
		flexShrink: 0,
		height: '100%',
		borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		':focus-visible': {
			outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
			outlineOffset: `calc(-1 * ${tokens.strokeWidthThick})`,
		},
	},
	body: {
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		paddingLeft: tokens.spacingHorizontalXS,
		paddingRight: tokens.spacingHorizontalXS,
		rowGap: tokens.spacingVerticalXS,
	},
	footer: {
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		paddingLeft: tokens.spacingHorizontalXS,
		paddingRight: tokens.spacingHorizontalXS,
		rowGap: tokens.spacingVerticalXS,
		borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
	/** A rail item: the icon above its caption, centered; the selection indicator on the start edge. */
	item: {
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		textAlign: 'center',
		rowGap: tokens.spacingVerticalXXS,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		paddingLeft: tokens.spacingHorizontalXXS,
		paddingRight: tokens.spacingHorizontalXXS,
		...typographyStyles.caption1,
		'::after': {
			top: '50%',
			insetInlineStart: 0,
			marginInlineStart: 0,
			transform: 'translateY(-50%)',
		},
	},
	itemSelected: {
		...typographyStyles.caption1Strong,
	},
	icon: {
		fontSize: tokens.fontSizeBase600,
		minHeight: tokens.lineHeightBase600,
		minWidth: tokens.lineHeightBase600,
		alignItems: 'center',
		// Fluent's NavItem only selects when the click target is an HTML element: a click on the icon's <svg> must land
		// on its <span> (the icon fills the top half of the item, where people click).
		'& svg': {
			pointerEvents: 'none',
		},
	},
	/** The running downloads count on the Models item, at the top-end corner of its icon. */
	badge: {
		position: 'absolute',
		top: tokens.spacingVerticalXS,
		insetInlineStart: `calc(50% + ${tokens.spacingHorizontalS})`,
		pointerEvents: 'none',
	},
	/** A bottom button (downloads, about), shaped like the items. */
	button: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		rowGap: tokens.spacingVerticalXXS,
		width: '100%',
		minWidth: 0,
		height: 'auto',
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		paddingLeft: tokens.spacingHorizontalXXS,
		paddingRight: tokens.spacingHorizontalXXS,
		color: tokens.colorNeutralForeground2,
		...typographyStyles.caption1,
		fontWeight: tokens.fontWeightRegular,
	},
	buttonIcon: {
		fontSize: tokens.fontSizeBase600,
		width: tokens.lineHeightBase600,
		height: tokens.lineHeightBase600,
		marginLeft: 0,
		marginRight: 0,
	},
	/** The overall progress of the running downloads, under the Downloads caption. */
	buttonProgress: {
		width: '100%',
	},
});
