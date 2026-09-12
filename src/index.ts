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
import { getShell } from './api';

/** Marks a root as mounted, so a second boot path is a no-op rather than a duplicate. */
const MOUNTED = 'atmeMounted';

type RenderCallback = (
	body: HTMLElement,
	ctx?: { params?: Record< string, unknown > }
) => Teardown;

/** Mounts into a root unless it already holds an explorer. */
function mountOnce( root: HTMLElement, params: Record< string, unknown > = {} ): Teardown {
	if ( root.dataset[ MOUNTED ] === '1' ) {
		return () => undefined;
	}

	root.dataset[ MOUNTED ] = '1';

	const teardown = mountExplorer( root, params );

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
	// Never overwrite the App Framework renderer when its runtime is already loaded.
	if ( getShell()?.getWindowConfig?.< { osApp?: boolean } >( 'allterrain-media-explorer' )?.osApp ) {
		return;
	}
	const w = window as unknown as {
		openStationNativeWindows?: Record< string, RenderCallback >;
	};

	w.openStationNativeWindows = w.openStationNativeWindows ?? {};
	w.openStationNativeWindows[ 'allterrain-media-explorer' ] = ( body: HTMLElement, ctx ) => {
		// The shell cloned the PHP template in before calling us; falling
		// back to the body itself covers a build that skipped the clone.
		const root = body.querySelector< HTMLElement >( '[data-atme-root]' ) ?? body;

		return mountOnce( root, ctx?.params );
	};

	w.openStationNativeWindows[ 'atme-viewer' ] = ( body, ctx ) => {
		const root = body.querySelector< HTMLElement >( '[data-atme-viewer-root]' ) ?? body;

		return mountViewer( root, ctx?.params ?? {} );
	};
}

registerNativeWindow();

/** The supported third-party queue works before or after the runtime loads. */
interface AppContext {
	root: HTMLElement;
	state: { mediaId: number; wizard: boolean; revision: number };
	loading: boolean;
	ui: < T >( factory: () => T ) => T;
}
interface ClientRuntime {
	html: ( strings: TemplateStringsArray, ...values: unknown[] ) => unknown;
	defineApp: ( id: string, definition: {
		placeholder: () => Record< string, never >;
		view: ( ctx: AppContext ) => unknown;
		mounted: ( ctx: AppContext ) => Teardown;
		updated: ( ctx: AppContext ) => void;
	} ) => unknown;
}

const pending = window as unknown as {
	openStationAppsPending?: { push: ( register: ( runtime: ClientRuntime ) => void ) => unknown };
};
( pending.openStationAppsPending ??= [] as Array< ( runtime: ClientRuntime ) => void > ).push( ( { defineApp, html } ) => {
	for ( const id of [ 'allterrain-media-explorer', 'atme-viewer' ] ) {
		const ui = ( ctx: AppContext ) => ctx.ui( () => ( {
			app: null as ReturnType< typeof mountExplorer > | null,
			revision: -1,
		} ) );
		defineApp( id, {
			placeholder: () => ( {} ),
			// The media canvas owns its children; same-template renders keep them.
			view: () => html`<div class="atme-app-host" os-preserve></div>`,
			mounted: ( ctx ) => {
				const host = ctx.root.querySelector< HTMLElement >( '.atme-app-host' )!;
				const params = ctx.loading ? {} : ctx.state;
				if ( id === 'atme-viewer' ) {
					host.classList.add( 'atme-viewer' );
					ui( ctx ).app = mountViewer( host, params );
				} else {
					host.classList.add( 'atme' );
					// Static frame only. Media values are painted with textContent.
					host.innerHTML = '<div class="atme__frame" data-atme-frame><aside class="atme__sidebar" data-atme-sidebar></aside><main class="atme__main" data-atme-main></main><aside class="atme__inspector" data-atme-inspector hidden></aside></div>';
					ui( ctx ).app = mountExplorer( host, params );
				}
				ui( ctx ).revision = ctx.loading ? -1 : ctx.state.revision;
				return () => { ui( ctx ).app?.(); ui( ctx ).app = null; };
			},
			updated: ( ctx ) => {
				const local = ui( ctx );
				if ( ! ctx.loading && local.app && local.revision !== ctx.state.revision ) {
					local.revision = ctx.state.revision;
					local.app.retarget( ctx.state );
				}
			},
		} );
	}
} );
