// Presentational texts of the Images section views (pure; no domain rules): the accessible name of an image (grid
// thumbnails, detail preview) and the site name of an external page link (also the Models section's page links).
import type { RemoteImage } from '../../api/types';

/** 'Image by <username>', or 'Image <id>' for an anonymous upload. */
export function imageLabel(image: Pick<RemoteImage, 'id' | 'username'>): string {
	return image.username ? `Image by ${image.username}` : `Image ${image.id}`;
}

/** Host name of a web page ('https://civitai.com/images/1' -> 'civitai.com'); the URL itself when unparsable. */
export function siteName(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}
