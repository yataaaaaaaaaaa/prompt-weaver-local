// "More options" of the generation panel, disclosed progressively (a Fluent Accordion, collapsed by default; whether it
// is open is ephemeral view state): adding model and LoRA files and folders from disk, and the prompt link details of
// the LoRAs. What a generation needs every time stays in the panel body.
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, Caption1Strong, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { LoraFileActions, PromptLinkedLoras } from '../library/LoraSection';
import { ModelFileActions } from '../library/ModelSection';
import { GENERATION_LABELS } from './generationLabels';

const useStyles = makeStyles({
	root: {
		paddingTop: tokens.spacingVerticalXS,
		borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		minWidth: 0,
	},
	header: {
		// Aligned with the section headings of the panel.
		marginLeft: `calc(-1 * ${tokens.spacingHorizontalS})`,
	},
	panel: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		margin: 0,
		paddingBottom: tokens.spacingVerticalS,
	},
	group: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
	},
	groupTitle: {
		color: tokens.colorNeutralForeground2,
	},
});

function OptionGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.group} role="group" aria-label={title}>
			<Caption1Strong className={styles.groupTitle}>{title}</Caption1Strong>
			{children}
		</div>
	);
}

export function AdvancedOptions(): JSX.Element {
	const styles = useStyles();
	return (
		<Accordion collapsible className={styles.root}>
			<AccordionItem value="more">
				<AccordionHeader as="h3" className={styles.header} expandIconPosition="end" size="medium">
					{GENERATION_LABELS.moreOptions}
				</AccordionHeader>
				<AccordionPanel className={styles.panel}>
					<OptionGroup title="Model files">
						<ModelFileActions />
					</OptionGroup>
					<OptionGroup title="LoRA files">
						<LoraFileActions />
					</OptionGroup>
					<OptionGroup title="Prompt-linked LoRAs">
						<PromptLinkedLoras />
					</OptionGroup>
				</AccordionPanel>
			</AccordionItem>
		</Accordion>
	);
}
