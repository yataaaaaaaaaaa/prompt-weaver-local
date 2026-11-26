// Descriptive badges of models and images: kind, base model, version name, local file, NSFW, not supported locally
// and selected for generation. The single owner of their look (appearance, color, icon), shared by the model result
// cards and detail panel, the local library entries and the image detail panel. File statuses ('In library', 'On disk', ...)
// are VersionStatusBadge's (VersionStatusBadge.tsx).
//
// Every look reads in both themes: never the 'subtle' color with the outline / tint appearances (white text and
// border, meant for dark or colored surfaces: invisible on a light card).
import { Badge } from '@fluentui/react-components';
import { CheckmarkCircleRegular, DocumentRegular, EyeOffRegular, WarningRegular } from '@fluentui/react-icons';
import type { ModelKind } from '../../api/types';
import { MODEL_KIND_LABELS } from '../../domain/modelCatalog';

/** Checkpoint / LoRA / Embedding (MODEL_KIND_LABELS). */
export function ModelKindBadge({ kind }: { kind: ModelKind }): JSX.Element {
	return (
		<Badge appearance="tint" color="brand">
			{MODEL_KIND_LABELS[kind]}
		</Badge>
	);
}

/** The provider's base model (e.g. 'SDXL 1.0'). */
export function BaseModelBadge({ baseModel }: { baseModel: string }): JSX.Element {
	return (
		<Badge appearance="outline" color="informative">
			{baseModel}
		</Badge>
	);
}

/** The provider's version name (e.g. 'v1.2'). */
export function VersionNameBadge({ name }: { name: string }): JSX.Element {
	return (
		<Badge appearance="outline" color="informative">
			{name}
		</Badge>
	);
}

/** A library entry added from disk (no provenance). */
export function LocalFileBadge(): JSX.Element {
	return (
		<Badge appearance="outline" color="informative" icon={<DocumentRegular />}>
			Local file
		</Badge>
	);
}

/** NSFW model or image. */
export function NsfwBadge(): JSX.Element {
	return (
		<Badge appearance="tint" color="danger" icon={<EyeOffRegular />}>
			NSFW
		</Badge>
	);
}

/** Made with a base model the local runtime cannot load. */
export function NotSupportedLocallyBadge(): JSX.Element {
	return (
		<Badge appearance="tint" color="warning" icon={<WarningRegular />}>
			Not supported locally
		</Badge>
	);
}

/** The library entry is selected for generation. */
export function SelectedBadge(): JSX.Element {
	return (
		<Badge appearance="filled" color="brand" icon={<CheckmarkCircleRegular />}>
			Selected
		</Badge>
	);
}
