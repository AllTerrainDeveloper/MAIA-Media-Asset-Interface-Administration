import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DropTarget, Folder } from '../../src/types';

const mocks = vi.hoisted( () => ( {
	file: vi.fn(), folders: vi.fn(), media: vi.fn(), toast: vi.fn(), notify: vi.fn(),
	targets: new Map< string, DropTarget >(),
} ) );
vi.mock( '../../src/api', async ( original ) => ( {
	...await original< typeof import('../../src/api') >(),
	fileIntoFolder: mocks.file,
	fetchFolders: mocks.folders,
	fetchMedia: mocks.media,
	fetchCollections: vi.fn().mockResolvedValue( [] ),
	getConfig: () => ( { canUpload: false } ),
	getShell: () => ( { showToast: mocks.toast, notify: mocks.notify } ),
	onMediaChanged: () => () => undefined,
} ) );
vi.mock( '../../src/dnd', () => ( { getDragManager: () => ( {
	registerDropTarget: ( target: DropTarget ) => {
		mocks.targets.set( target.id, target );
		return () => mocks.targets.delete( target.id );
	},
} ) } ) );
vi.mock( '../../src/grid', () => ( { MediaGrid: class {
	setItems = vi.fn(); selectedIds = () => []; destroy = vi.fn();
} } ) );
vi.mock( '../../src/inspector', () => ( { mountInspector: () => ( { showEmpty: vi.fn(), destroy: vi.fn() } ) } ) );
vi.mock( '../../src/quicklook', () => ( { mountQuickLook: () => ( { destroy: vi.fn() } ) } ) );
vi.mock( '../../src/wizard', () => ( { mountWizard: () => ( { destroy: vi.fn() } ) } ) );
import { mountExplorer, type MountedMediaApp } from '../../src/app';

function deferred< T >() {
	let resolve!: ( value: T ) => void;
	let reject!: ( error: Error ) => void;
	const promise = new Promise< T >( ( done, fail ) => { resolve = done; reject = fail; } );
	return { promise, resolve, reject };
}

const folder = { id: 7, name: 'Products', parent: 0, count: 3 };
let root: HTMLElement;
let off: MountedMediaApp;
const row = () => root.querySelector< HTMLButtonElement >( '[data-folder-id="7"]' )!;
const status = () => root.querySelector( '.atme-filing-status' )!;
function drop( target = 'folder-7', ids = [ 42 ] ) {
	return mocks.targets.get( `allterrain-media-explorer/${ target }` )!.onDrop( {
		payload: { type: 'shortcut', source: document.createElement( 'div' ), data: {
			items: ids.map( ( id ) => ( { kind: 'attachment', ref: String( id ) } ) ),
		} },
		isFinished: () => true, cancel: vi.fn(),
	}, { clientX: 0, clientY: 0 } );
}

beforeEach( async () => {
	vi.clearAllMocks(); mocks.targets.clear();
	mocks.file.mockReset(); mocks.folders.mockReset();
	mocks.folders.mockResolvedValue( [ folder ] );
	mocks.media.mockResolvedValue( { items: [], total: 0, totalPages: 1 } );
	root = document.createElement( 'div' );
	root.innerHTML = '<div data-atme-frame><div data-atme-sidebar></div><div data-atme-main></div><div data-atme-inspector></div></div>';
	document.body.appendChild( root );
	off = mountExplorer( root );
	await vi.waitFor( () => expect( row() ).not.toBeNull() );
} );
afterEach( () => { off(); root.remove(); } );

describe( 'folder filing feedback', () => {
	it( 'shows pending feedback immediately and keeps it through navigation and the refresh', async () => {
		const save = deferred< { filed: number } >();
		const refresh = deferred< Folder[] >();
		mocks.file.mockReturnValue( save.promise );
		mocks.folders.mockReturnValueOnce( refresh.promise );
		const done = drop( 'folder-7', [ 42, 43 ] );
		expect( mocks.file ).toHaveBeenCalledWith( [ 42, 43 ], 7 );
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( row().textContent ).toContain( 'Saving…' );
		expect( status().textContent ).toBe( 'Saving 2 items into Products…' );
		expect( status().getAttribute( 'role' ) ).toBe( 'status' );
		const original = row();
		row().click();
		expect( row() ).not.toBe( original );
		expect( row().classList.contains( 'is-saving' ) ).toBe( true );
		save.resolve( { filed: 2 } );
		await vi.waitFor( () => expect( mocks.folders ).toHaveBeenCalledTimes( 2 ) );
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( mocks.toast ).not.toHaveBeenCalled();
		refresh.resolve( [ { ...folder, count: 5 } ] );
		await done;
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'false' );
		expect( row().querySelector( '.atme-side__saving' ) ).toBeNull();
		expect( row().querySelector( '.atme-side__count' )?.textContent ).toBe( '5' );
		expect( status().textContent ).toBe( 'Filed 2 items into Products.' );
	} );

	it( 'reports failures without changing counts, then allows a retry', async () => {
		mocks.file.mockRejectedValueOnce( new Error( 'Network offline' ) );
		await drop();
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'false' );
		expect( status().textContent ).toContain( 'Could not file 1 item into Products. Try again.' );
		expect( status().classList.contains( 'is-error' ) ).toBe( true );
		expect( mocks.toast ).not.toHaveBeenCalled();
		expect( mocks.notify ).toHaveBeenCalledWith( expect.objectContaining( { body: 'Network offline', type: 'error' } ) );
		expect( mocks.folders ).toHaveBeenCalledOnce();
		expect( row().querySelector( '.atme-side__count' )?.textContent ).toBe( '3' );
		mocks.file.mockResolvedValueOnce( { filed: 1 } );
		await drop();
		expect( status().classList.contains( 'is-error' ) ).toBe( false );
		expect( status().textContent ).toBe( 'Filed 1 item into Products.' );
	} );

	it( 'keeps the spinner until every overlapping drop settles', async () => {
		const first = deferred< { filed: number } >();
		const second = deferred< { filed: number } >();
		mocks.file.mockReturnValueOnce( first.promise ).mockReturnValueOnce( second.promise );
		const a = drop();
		const b = drop();
		first.resolve( { filed: 1 } );
		await a;
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'true' );
		second.reject( new Error( 'No connection' ) );
		await b;
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'false' );
		expect( status().classList.contains( 'is-error' ) ).toBe( true );
	} );

	it( 'uses the same feedback for an external drop into the current folder grid', async () => {
		row().click();
		const save = deferred< { filed: number } >();
		mocks.file.mockReturnValue( save.promise );
		const done = drop( 'grid' );
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( mocks.file ).toHaveBeenCalledWith( [ 42 ], 7 );
		save.resolve( { filed: 1 } );
		await done;
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'false' );
	} );

	it.each( [ false, true ] )( 'does not revive a closed window when a save settles (failure: %s)', async ( fail ) => {
		const save = deferred< { filed: number } >();
		mocks.file.mockReturnValue( save.promise );
		const done = drop();
		off();
		root.replaceChildren();
		if ( fail ) { save.reject( new Error( 'Offline' ) ); } else { save.resolve( { filed: 1 } ); }
		await done;
		expect( root.childElementCount ).toBe( 0 );
		expect( mocks.targets.size ).toBe( 0 );
		expect( mocks.folders ).toHaveBeenCalledOnce();
		expect( mocks.toast ).not.toHaveBeenCalled();
		expect( mocks.notify ).not.toHaveBeenCalled();
	} );
} );
