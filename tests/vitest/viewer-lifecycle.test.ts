import { describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../../src/types';
const mocks = vi.hoisted( () => ( { fetch: vi.fn(), title: vi.fn(), inspector: vi.fn() } ) );
vi.mock( '../../src/api', () => ( {
	fetchMediaItem: mocks.fetch,
	fetchNeighbors: vi.fn().mockResolvedValue( { prev: null, next: null } ),
	getShell: () => ( { windowManager: { getById: () => ( { setTitle: mocks.title } ) } } ),
	onMediaChanged: () => () => undefined,
	fetchUsage: vi.fn().mockResolvedValue( [] ),
	getConfig: () => ( { adminUrl: 'https://example.test/wp-admin/' } ),
} ) );
vi.mock( '../../src/inspector', () => ( { mountInspector: mocks.inspector } ) );
import { mountViewer } from '../../src/viewer';

describe( 'viewer teardown', () => {
	it( 'ignores media that finishes loading after the window closes', async () => {
		let resolve!: ( item: MediaItem ) => void;
		mocks.fetch.mockReturnValue( new Promise( done => { resolve = done; } ) );
		const root = document.createElement( 'div' );
		const off = mountViewer( root, { mediaId: 5 } );
		off();
		resolve( { id: 5, title: 'Closed photo', kind: 'image', width: 10, height: 10 } as MediaItem );
		await Promise.resolve(); await Promise.resolve();
		expect( root.childElementCount ).toBe( 0 );
		expect( mocks.title ).not.toHaveBeenCalled();
		expect( mocks.inspector ).not.toHaveBeenCalled();
	} );
} );
