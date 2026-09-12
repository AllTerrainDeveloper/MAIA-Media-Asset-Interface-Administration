/**
 * The one verb every surface shares: show this item in the Media Viewer.
 *
 * Called from a grid double-click, the desktop file opener, and anything
 * else that wants a picture on screen. Open-time params survive cold opens
 * and session restore; the framework's reopen action retargets a singleton.
 * Legacy shells also receive the existing broadcast topic.
 */

import { getShell } from './api';

export const VIEWER_WINDOW_ID = 'atme-viewer';

/** The topic an open viewer retargets on. */
export const VIEW_TOPIC = 'atme.view';

export function openViewer( id: number ): void {
	const shell = getShell();

	if ( ! shell || id <= 0 ) {
		return;
	}


	shell.openWindow?.( VIEWER_WINDOW_ID, {
		source: 'allterrain-media-explorer',
		params: { mediaId: id },
	} );

	if ( ! shell.getWindowConfig?.< { osApp?: boolean } >( VIEWER_WINDOW_ID )?.osApp ) {
		shell.broadcast?.( VIEW_TOPIC, { id } );
	}
}
