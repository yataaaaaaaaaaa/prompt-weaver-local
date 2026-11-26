// THE 'Active' badge of the character active for generation (gallery card picture, character details): brand filled,
// with a check icon (the word is the cue, not the color alone).
import { Badge } from '@fluentui/react-components';
import { CheckmarkCircleFilled } from '@fluentui/react-icons';

export function ActiveBadge({ className }: { className?: string }): JSX.Element {
	return (
		<Badge className={className} appearance="filled" color="brand" icon={<CheckmarkCircleFilled />}>
			Active
		</Badge>
	);
}
