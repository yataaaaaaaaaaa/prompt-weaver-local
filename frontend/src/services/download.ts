// Browser download of text the app produced (e.g. a story exported as an HTML page) when the desktop app's save dialog
// is not available (`launcher --web`, the e2e suite): a Blob URL clicked through a temporary <a download>. Stores call
// it; views never do.

export const download = {
	/** Starts the browser download of `content` as `fileName`. */
	text: (fileName: string, content: string, mimeType: string): void => {
		const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
		const link = document.createElement('a');
		link.href = url;
		link.download = fileName;
		link.style.display = 'none';
		document.body.append(link);
		try {
			link.click();
		} finally {
			link.remove();
			// Revoked once the click has started the download.
			setTimeout(() => URL.revokeObjectURL(url), 0);
		}
	},
};
