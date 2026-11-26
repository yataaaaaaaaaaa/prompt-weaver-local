// Status of a downloadable file as the views show it: the single owner of the label, color and icon of every
// VersionStatusKind (src/domain/modelCatalog.ts), e.g. 'On disk' for a local copy found by the backend. Used by the
// model result cards and detail panel, the image resources (which add their own resolution states) and the IP-Adapter files of
// the characters views. StatusBadge renders a look (tint badge with icon) and forwards its ref and extra props, so a
// Tooltip can wrap it.
import { Badge, type BadgeProps } from '@fluentui/react-components';
import {
	ArrowDownloadRegular,
	CheckmarkCircleRegular,
	CloudArrowDownRegular,
	ErrorCircleRegular,
	HardDriveRegular,
	WarningRegular,
	type FluentIcon,
} from '@fluentui/react-icons';
import { forwardRef } from 'react';
import type { VersionStatusKind } from '../../domain/modelCatalog';

export type StatusBadgeLook = { label: string; color: NonNullable<BadgeProps['color']>; icon: FluentIcon };

/** Look of every VersionStatusKind (exhaustive: the type-check fails when a status is added). */
export const VERSION_STATUS_BADGES: Readonly<Record<VersionStatusKind, StatusBadgeLook>> = {
	in_library: { label: 'In library', color: 'success', icon: CheckmarkCircleRegular },
	on_disk: { label: 'On disk', color: 'success', icon: HardDriveRegular },
	remote: { label: 'Available to download', color: 'informative', icon: CloudArrowDownRegular },
	installing: { label: 'Downloading', color: 'brand', icon: ArrowDownloadRegular },
	failed: { label: 'Failed', color: 'danger', icon: ErrorCircleRegular },
	unavailable: { label: 'Not supported', color: 'warning', icon: WarningRegular },
};

export type StatusBadgeProps = Omit<BadgeProps, 'color' | 'icon' | 'appearance' | 'children'> & { look: StatusBadgeLook };

/** A tint badge with the look's icon, color and label. */
export const StatusBadge = forwardRef<HTMLDivElement, StatusBadgeProps>(function StatusBadge({ look, ...props }, ref) {
	const { label, color, icon: Icon } = look;
	return (
		<Badge ref={ref} appearance="tint" color={color} icon={<Icon />} {...props}>
			{label}
		</Badge>
	);
});

export type VersionStatusBadgeProps = Omit<StatusBadgeProps, 'look'> & { kind: VersionStatusKind };

/** The badge of a VersionStatusKind. */
export const VersionStatusBadge = forwardRef<HTMLDivElement, VersionStatusBadgeProps>(function VersionStatusBadge({ kind, ...props }, ref) {
	return <StatusBadge ref={ref} look={VERSION_STATUS_BADGES[kind]} {...props} />;
});
