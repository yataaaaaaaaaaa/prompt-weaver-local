// THE label, color and icon of each scene illustration status (src/domain/stories.ts SceneStatus), for the scene cards
// and the scene details: a tinted Fluent badge (readable text in both themes) whose icon and text name the status, so
// color is never the only cue. Pure view.
import { Badge, type BadgeProps } from '@fluentui/react-components';
import { ArrowSyncCircleRegular, CheckmarkCircleRegular, ClockRegular, ImageOffRegular } from '@fluentui/react-icons';
import type { ReactElement } from 'react';
import type { SceneStatus } from '../../domain/stories';

export const SCENE_STATUS_LABELS: Readonly<Record<SceneStatus, string>> = {
	generating: 'Generating',
	queued: 'Queued',
	illustrated: 'Illustrated',
	missing: 'Not illustrated',
};

const STATUS_LOOKS: Readonly<Record<SceneStatus, { color: NonNullable<BadgeProps['color']>; icon: ReactElement }>> = {
	generating: { color: 'brand', icon: <ArrowSyncCircleRegular /> },
	queued: { color: 'informative', icon: <ClockRegular /> },
	illustrated: { color: 'success', icon: <CheckmarkCircleRegular /> },
	missing: { color: 'warning', icon: <ImageOffRegular /> },
};

export function SceneStatusBadge({ status, className, id }: { status: SceneStatus; className?: string; id?: string }): JSX.Element {
	const look = STATUS_LOOKS[status];
	return (
		<Badge id={id} appearance="tint" color={look.color} icon={look.icon} className={className} data-scene-status={status}>
			{SCENE_STATUS_LABELS[status]}
		</Badge>
	);
}
