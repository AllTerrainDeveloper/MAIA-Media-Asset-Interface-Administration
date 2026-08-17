/**
 * Explorer bundle entry.
 *
 * The shell calls the render callback we hang on
 * `window.openStationNativeWindows['allterrain-media-explorer']`, hands it
 * the window body (already populated with the PHP template's markup), and
 * keeps whatever we return as the teardown for when the window closes.
 *
 * The guard is "did I already mount into this element", not "which host am
 * I" — a shell build that calls twice gets one explorer.
 */

import { mountExplorer, type Teardown } from './app';
import { mountViewer } from './viewer';

/** Marks a root as mounted, so a second boot path is a no-op rather than a duplicate. */
const MOUNTED = 'atmeMounted';

type RenderCallback = (
	body: HTMLElement,
	ctx?: { params?: Record< string, unknown > }
) => Teardown;

/** Mounts into a root unless it already holds an explorer. */
function mountOnce( root: HTMLElement ): Teardown {
	if ( root.dataset[ MOUNTED ] === '1' ) {
		return () => undefined;
	}

	root.dataset[ MOUNTED ] = '1';

	const teardown = mountExplorer( root );

	return () => {
		delete root.dataset[ MOUNTED ];
		teardown();
	};
}

/**
 * Registers the native-window render callback.
 *
 * Declared unconditionally: on a page with no shell nobody ever reads it.
 */
function registerNativeWindow(): void {
	const w = window as unknown as {
		openStationNativeWindows?: Record< string, RenderCallback >;
	};

	w.openStationNativeWindows = w.openStationNativeWindows ?? {};
	w.openStationNativeWindows[ 'allterrain-media-explorer' ] = ( body: HTMLElement ) => {
		// The shell cloned the PHP template in before calling us; falling
		// back to the body itself covers a build that skipped the clone.
		const root = body.querySelector< HTMLElement >( '[data-atme-root]' ) ?? body;

		return mountOnce( root );
	};

	w.openStationNativeWindows[ 'atme-viewer' ] = ( body, ctx ) => {
		const root = body.querySelector< HTMLElement >( '[data-atme-viewer-root]' ) ?? body;

		return mountViewer( root, ctx?.params ?? {} );
	};
}

registerNativeWindow();
