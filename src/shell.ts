/**
 * The eager bundle: everything that must exist before the window opens.
 *
 * Loaded at shell boot (`openstation_mode_init`), while the explorer bundle
 * waits for its window. Three jobs, all of them registrations the shell
 * consults on its own schedule:
 *
 *   1. The file opener — double-clicking any `attachment` desktop file
 *      opens the explorer revealing that item.
 *   2. The ⌘K commands — open the explorer, start the wizard.
 *   3. WP Explorer's "Reveal in Media Explorer" preview action — the PHP
 *      half declared the button; this wires what it does.
 */

import { getShell } from './api';
import { openViewer } from './view-open';

const WINDOW_ID = 'allterrain-media-explorer';

/** Opens or retargets the library using persistent window params. */
function openAndReveal( id: number ): void {
	const shell = getShell();

	if ( ! shell ) {
		return;
	}

	shell.openWindow?.( WINDOW_ID, { source: 'allterrain-media-explorer', params: { mediaId: id } } );
	if ( id > 0 && ! shell.getWindowConfig?.< { osApp?: boolean } >( WINDOW_ID )?.osApp ) {
		shell.broadcast?.( 'atme.reveal', { id } );
	}
}

function registerFileOpener(): void {
	const shell = getShell();

	// The default: double-clicking a media desktop file shows the picture,
	// not a form. `js` rather than `window` handlers throughout — the
	// shell's `window` kind opens the window but drops the per-file config
	// on the way, so the subject would be lost.
	shell?.files?.registerOpener?.( {
		id: 'atme-viewer',
		label: 'AllTerrain MAIA Viewer',
		types: [ 'attachment' ],
		sort: 5,
		// Deliberately NOT default-flagged: the "(default)" suffix in the
		// Preferences dropdown marks the opener WordPress ships, and that
		// honour stays with the stock media editor. AllTerrain MAIA becomes the
		// *effective* opener through the association below — the same
		// mechanism a user's own pick uses, shown as the selected row.
		isDefault: false,
		handler: {
			kind: 'js',
			open: ( file ) => openViewer( Number( file.ref() ) ),
		},
	} );

	// Out of the box, double-clicking a media file opens AllTerrain MAIA — through the
	// shell's own resolution filter, which runs after the user-override and
	// default-flag steps. Deferential by construction: a stored pick in
	// Preferences (any opener, including the stock editor) short-circuits
	// before this filter matters, so it only ever decides the "no
	// preference yet" case. The Preferences dropdown mirrors the same
	// resolution, so AllTerrain MAIA shows as the selected row while "(default)"
	// stays on the opener WordPress ships.
	const hooks = ( window as unknown as {
		wp?: { hooks?: { addFilter: ( h: string, ns: string, cb: ( ...a: unknown[] ) => unknown ) => void } };
	} ).wp?.hooks;

	hooks?.addFilter( 'os.files.resolve-opener', 'allterrain-media-explorer', ( resolved, type ) => {
		if ( 'attachment' !== type ) {
			return resolved;
		}

		const stored = getShell()?.files?.getUserAssociations?.() ?? {};

		if ( stored[ 'attachment' ] ) {
			return resolved;
		}

		return getShell()?.files?.getOpener?.( 'atme-viewer' ) ?? resolved;
	} );
}

/**
 * Drops on the wallpaper icon reveal the dropped item.
 *
 * Registered through the shell's tile payload registry — a raw DropTarget
 * on the tile is silently displaced by the tile's own claimant.
 */
function registerIconDropHandler(): void {
	const files = getShell()?.files;

	if ( ! files?.registerTilePayloadHandler ) {
		return;
	}

	const isOurIcon = ( ctx: { placement?: { file?: { ref?: string } } } ) =>
		ctx?.placement?.file?.ref === WINDOW_ID;

	files.registerTilePayloadHandler( 'shortcut', {
		appliesTo: isOurIcon,
		accept: ( data ) => data?.kind === 'attachment',
		acceptLabel: 'Reveal in AllTerrain MAIA',
		onDrop: ( session ) => openAndReveal( Number( session.payload.data?.ref ?? 0 ) ),
	} );

	files.registerTilePayloadHandler( 'desktop-file', {
		appliesTo: isOurIcon,
		accept: ( data ) => {
			const placement = data?.placement as { file?: { type?: string } } | undefined;

			return placement?.file?.type === 'attachment';
		},
		acceptLabel: 'Reveal in AllTerrain MAIA',
		onDrop: ( session ) => {
			const placement = session.payload.data?.placement as { file?: { ref?: string } } | undefined;

			openAndReveal( Number( placement?.file?.ref ?? 0 ) );
		},
	} );
}

function registerCommands(): void {
	const shell = getShell();

	if ( ! shell?.registerCommand ) {
		return;
	}

	shell.registerCommand( {
		slug: 'allterrain-media-explorer',
		label: 'AllTerrain MAIA: open the media library',
		description: 'Browse, organize and convert everything in the media library.',
		icon: 'dashicons-format-gallery',
		run: () => {
			openAndReveal( 0 );

			return 'Opening AllTerrain MAIA…';
		},
	} );

	shell.registerCommand( {
		slug: 'allterrain-media-explorer-wizard',
		label: 'AllTerrain MAIA: start the optimization wizard',
		description: 'Scan the library for oversized images, legacy formats, missing alt text and duplicates.',
		icon: 'dashicons-superhero',
		run: () => {
			getShell()?.openWindow?.( WINDOW_ID, { params: { wizard: true } } );
			if ( ! getShell()?.getWindowConfig?.< { osApp?: boolean } >( WINDOW_ID )?.osApp ) {
				getShell()?.broadcast?.( 'atme.wizard', {} );
			}

			return 'Opening the optimization wizard…';
		},
	} );
}

/**
 * Wires the WP Explorer preview action the PHP half declared.
 *
 * `os.my-wordpress.preview-actions` is a filter the Explorer runs while
 * painting a preview; the handler must attach `onSelect` to our action id.
 */
function wireExplorerAction(): void {
	const hooks = ( window as unknown as {
		wp?: { hooks?: { addFilter: ( h: string, ns: string, cb: ( a: unknown ) => unknown ) => void } };
	} ).wp?.hooks;

	if ( ! hooks ) {
		return;
	}

	hooks.addFilter( 'os.my-wordpress.preview-actions', 'allterrain-media-explorer', ( actions ) => {
		if ( ! Array.isArray( actions ) ) {
			return actions;
		}

		return actions.map( ( action: { id?: string } ) =>
			action?.id === 'atme-reveal'
				? {
						...action,
						onSelect: ( context: { postId?: number; mediaId?: number } ) =>
							openAndReveal( Number( context?.mediaId ?? context?.postId ?? 0 ) ),
				  }
				: action
		);
	} );
}

function boot(): void {
	registerFileOpener();
	registerIconDropHandler();
	registerCommands();
	wireExplorerAction();
}

const shell = getShell();

if ( shell?.ready ) {
	shell.ready( boot );
} else {
	// The shell script loads independently of this one; `os-init` fires
	// after the public API is mounted.
	document.addEventListener( 'os-init', boot, { once: true } );
}
