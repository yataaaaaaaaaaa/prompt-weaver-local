// API token of the active provider (e.g. Civitai): trigger button + 'Token set' badge, and a dialog to save or
// remove the token through modelCatalogStore.setProviderToken. The token only lives in the local draft of the
// open dialog (cleared on close); the backend stores it and only reports token_set.
import {
	Badge,
	Body1,
	Button,
	Dialog,
	DialogActions,
	DialogBody,
	DialogContent,
	DialogSurface,
	DialogTitle,
	DialogTrigger,
	Field,
	Input,
	makeStyles,
	tokens,
} from '@fluentui/react-components';
import { KeyRegular } from '@fluentui/react-icons';
import { useState, type FormEvent } from 'react';
import { selectActiveProvider, useModelCatalogStore } from '../../stores/modelCatalogStore';

const useStyles = makeStyles({
	trigger: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXS,
	},
	content: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
	},
});

export function ProviderTokenDialog(): JSX.Element | null {
	const styles = useStyles();
	const provider = useModelCatalogStore(selectActiveProvider);
	const setProviderToken = useModelCatalogStore((state) => state.setProviderToken);
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);

	if (!provider?.token_supported) {
		return null;
	}

	const close = () => {
		setOpen(false);
		setDraft('');
	};
	const submit = async (token: string | null) => {
		setBusy(true);
		try {
			await setProviderToken(provider.id, token);
		} finally {
			setBusy(false);
			close();
		}
	};
	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		// Sent as typed: the backend owns the token rules (surrounding whitespace stripped, blank = removed).
		if (draft.trim()) {
			void submit(draft);
		}
	};

	return (
		<div className={styles.trigger}>
			{provider.token_set ? (
				<Badge appearance="tint" color="success">
					Token set
				</Badge>
			) : null}
			<Dialog
				open={open}
				onOpenChange={(_event, data) => {
					if (data.open) {
						setOpen(true);
					} else {
						close();
					}
				}}
			>
				<DialogTrigger disableButtonEnhancement>
					<Button appearance="subtle" size="small" icon={<KeyRegular />}>
						{provider.label} token
					</Button>
				</DialogTrigger>
				<DialogSurface>
					<form onSubmit={onSubmit}>
						<DialogBody>
							<DialogTitle>{provider.label} API token</DialogTitle>
							<DialogContent className={styles.content}>
								<Body1>
									Some downloads need an API token. It is stored in the backend settings only and is never shown again.{' '}
									{provider.token_set ? 'A token is currently stored.' : 'No token is stored.'}
								</Body1>
								<Field label="API token" hint={provider.token_set ? 'Saving replaces the stored token.' : undefined}>
									<Input
										type="password"
										autoComplete="off"
										value={draft}
										disabled={busy}
										onChange={(_event, data) => setDraft(data.value)}
									/>
								</Field>
							</DialogContent>
							{provider.token_set ? (
								<DialogActions position="start">
									<Button disabled={busy} onClick={() => void submit(null)}>
										Remove token
									</Button>
								</DialogActions>
							) : null}
							<DialogActions position="end">
								<DialogTrigger disableButtonEnhancement>
									<Button disabled={busy}>Cancel</Button>
								</DialogTrigger>
								<Button type="submit" appearance="primary" disabled={busy || !draft.trim()}>
									Save
								</Button>
							</DialogActions>
						</DialogBody>
					</form>
				</DialogSurface>
			</Dialog>
		</div>
	);
}
