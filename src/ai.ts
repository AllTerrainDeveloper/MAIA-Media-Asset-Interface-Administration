/** AI requests share one disclosure and consent gate. No background requests. */
import { getShell } from './api';
import type { MediaItem } from './types';

/** Ask only after explaining which media fields leave the site. */
export async function suggestAltText( item: MediaItem ): Promise< string | null > {
	const shell = getShell();
	if ( ! shell?.ai?.ask || ! shell.confirm ) {
		return null;
	}
	const allowed = await shell.confirm( {
		title: 'Send media details to AI?',
		message: 'The image URL, title and caption will be sent to the AI provider configured in OpenStation to draft alt text. The provider may fetch the image at that URL. Its terms and privacy policy apply.',
		confirmLabel: 'Send and draft',
	} );
	if ( ! allowed ) {
		return null;
	}
	const answer = await shell.ai.ask(
		`Write concise, descriptive alt text (under 15 words, no quotes, no "image of") for a WordPress media item. Its file URL is ${ item.url }, its title is "${ item.title }" and its caption is "${ item.caption }". Reply with the alt text only.`
	);
	const text = typeof answer === 'string' ? answer : answer?.message;
	const alt = typeof text === 'string' ? text.trim().replace( /^"|"$/g, '' ) : '';
	if ( ! alt || alt.length > 300 ) {
		throw new Error( 'The assistant did not return usable alt text.' );
	}
	return alt;
}
