import { beforeEach, describe, expect, it, vi } from 'vitest';
const mounts = vi.hoisted( () => ( { explorer: vi.fn(), viewer: vi.fn() } ) );
vi.mock( '../../src/app', () => ( { mountExplorer: mounts.explorer } ) );
vi.mock( '../../src/viewer', () => ( { mountViewer: mounts.viewer } ) );

const w = window as unknown as {
	wp: unknown;
	openStationAppsPending?: Array< ( api: unknown ) => void >;
	openStationNativeWindows: Record< string, unknown >;
};

beforeEach( () => {
	vi.resetModules(); vi.clearAllMocks();
	delete w.openStationAppsPending;
	w.openStationNativeWindows = {};
	document.body.replaceChildren();
} );

describe( 'App Framework lifecycle', () => {
	it( 'does not replace an already loaded framework renderer with the legacy renderer', async () => {
		const renderer = vi.fn();
		w.wp = { os: { getWindowConfig: () => ( { osApp: true } ) } };
		w.openStationNativeWindows[ 'allterrain-media-explorer' ] = renderer;
		await import( '../../src/index' );
		expect( w.openStationNativeWindows[ 'allterrain-media-explorer' ] ).toBe( renderer );
		expect( w.openStationAppsPending ).toHaveLength( 1 );
	} );
	it( 'mounts each app once, retargets on reopen and disposes its canvas', async () => {
		w.wp = { os: { getWindowConfig: () => ( { osApp: true } ) } };
		await import( '../../src/index' );
		const defs: Record< string, any > = {};
		w.openStationAppsPending![0]( { html: () => '', defineApp: ( id: string, def: unknown ) => { defs[id] = def; } } );
		for ( const id of [ 'allterrain-media-explorer', 'atme-viewer' ] ) {
			const dispose = Object.assign( vi.fn(), { retarget: vi.fn() } );
			( id === 'atme-viewer' ? mounts.viewer : mounts.explorer ).mockReturnValue( dispose );
			const root = document.createElement( 'div' );
			root.innerHTML = '<div class="atme-app-host"></div>';
			let bag: unknown;
			const ctx = { root, state: { mediaId: 5, wizard: false, revision: 1 }, loading: false, ui: ( factory: () => unknown ) => ( bag ??= factory() ) };
			const off = defs[id].mounted( ctx );
			defs[id].updated( ctx );
			expect( dispose.retarget ).not.toHaveBeenCalled();
			ctx.state = { mediaId: 9, wizard: false, revision: 2 };
			defs[id].updated( ctx );
			defs[id].updated( ctx );
			expect( dispose.retarget ).toHaveBeenCalledOnce();
			expect( dispose.retarget ).toHaveBeenCalledWith( ctx.state );
			off();
			expect( dispose ).toHaveBeenCalledOnce();
		}
	} );
} );
