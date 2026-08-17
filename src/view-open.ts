/**
 * The one verb every surface shares: show this item in the Media Viewer.
 *
 * Called from a grid double-click, the desktop file opener, and anything
 * else that wants a picture on screen. The id travels three ways at once —
 * open-time `params` (cold open, survives session restore), a broadcast
 * (retargets an already-open viewer), and a parked global (covers the gap
 * while a fresh window's bundle boots) — so whichever path wins, the other
 * two are no-ops.
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

	( window as unknown as { __atmeView?: number } ).__atmeView = id;

	shell.openWindow?.( VIEWER_WINDOW_ID, {
		source: 'allterrain-media-explorer',
		params: { mediaId: id },
	} );

	shell.broadcast?.( VIEW_TOPIC, { id } );
}
