import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DropTarget, Folder } from '../../src/types';

const mocks = vi.hoisted( () => ( {
	create: vi.fn(), delete: vi.fn(), confirm: vi.fn(), file: vi.fn(), folders: vi.fn(), media: vi.fn(), toast: vi.fn(), notify: vi.fn(),
	targets: new Map< string, DropTarget >(),
} ) );
vi.mock( '../../src/api', async ( original ) => ( {
	...await original< typeof import('../../src/api') >(),
	fileIntoFolder: mocks.file,
	createFolder: mocks.create,
	deleteFolder: mocks.delete,
	fetchFolders: mocks.folders,
	fetchMedia: mocks.media,
	fetchCollections: vi.fn().mockResolvedValue( [] ),
	getConfig: () => ( { canUpload: false } ),
	getShell: () => ( { showToast: mocks.toast, notify: mocks.notify, confirm: mocks.confirm } ),
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
	mocks.create.mockReset(); mocks.delete.mockReset(); mocks.confirm.mockReset();
	mocks.folders.mockResolvedValue( [ folder ] );
	mocks.media.mockResolvedValue( { items: [], total: 0, totalPages: 1 } );
	root = document.createElement( 'div' );
	root.innerHTML = '<div data-atme-frame><div data-atme-sidebar></div><div data-atme-main></div><div data-atme-inspector></div></div>';
	document.body.appendChild( root );
	off = mountExplorer( root );
	await vi.waitFor( () => expect( row() ).not.toBeNull() );
} );
afterEach( () => { off(); root.remove(); if ( vi.isMockFunction( window.prompt ) ) { vi.mocked( window.prompt ).mockRestore(); } } );

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

function clickAction( text: string ) {
	const button = Array.from( root.querySelectorAll< HTMLButtonElement >( 'button' ) )
		.find( ( item ) => item.textContent === text );
	expect( button ).toBeDefined();
	button!.click();
}

function fillName( value: string ) {
	const input = root.querySelector< HTMLInputElement >( '.atme-name-form input' )!;
	input.value = value;
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
}

describe( 'folder management', () => {
	it( 'creates a top-level folder even while Products is selected', async () => {
		row().click();
		mocks.create.mockResolvedValue( { id: 8 } );
		mocks.folders.mockResolvedValue( [ folder, { id: 8, name: 'Campaigns', parent: 0, count: 0 } ] );
		clickAction( '+ New top-level folder' );
		expect( root.querySelector( '.atme-name-form' )?.textContent ).toContain( 'At the top level' );
		fillName( '  Campaigns  ' );
		clickAction( 'Create folder' );
		await vi.waitFor( () => expect( mocks.create ).toHaveBeenCalledWith( 'Campaigns', 0 ) );
		await vi.waitFor( () => expect( root.querySelector( '[data-folder-id="8"]' )?.classList.contains( 'is-active' ) ).toBe( true ) );
	} );

	it( 'creates children only through the explicit subfolder action', async () => {
		row().click();
		mocks.create.mockResolvedValue( { id: 9 } );
		clickAction( '+ New subfolder' );
		expect( root.querySelector( '.atme-name-form' )?.textContent ).toContain( 'Inside “Products”' );
		fillName( 'Summer' );
		clickAction( 'Create folder' );
		await vi.waitFor( () => expect( mocks.create ).toHaveBeenCalledWith( 'Summer', 7 ) );
	} );

	it( 'validates inline and cancels without any browser dialog', () => {
		const prompt = vi.spyOn( window, 'prompt' );
		clickAction( '+ New top-level folder' );
		fillName( '   ' );
		clickAction( 'Create folder' );
		expect( root.querySelector( '.atme-name-form [role="status"]' )?.textContent ).toBe( 'Please enter a name.' );
		clickAction( 'Cancel' );
		expect( root.querySelector( '.atme-name-form' ) ).toBeNull();
		expect( mocks.create ).not.toHaveBeenCalled();
		expect( prompt ).not.toHaveBeenCalled();
	} );

	it( 'keeps the draft through sidebar navigation and retries inline after a server error', async () => {
		clickAction( '+ New top-level folder' );
		fillName( 'Campaigns' );
		row().click();
		expect( root.querySelector< HTMLInputElement >( '.atme-name-form input' )?.value ).toBe( 'Campaigns' );
		const save = deferred< { id: number } >();
		mocks.create.mockReturnValueOnce( save.promise ).mockResolvedValueOnce( { id: 8 } );
		clickAction( 'Create folder' );
		expect( root.querySelector( '.atme-name-form' )?.getAttribute( 'aria-busy' ) ).toBe( 'true' );
		clickAction( 'Saving…' );
		expect( mocks.create ).toHaveBeenCalledOnce();
		save.reject( new Error( 'Folder already exists' ) );
		await vi.waitFor( () => expect( root.querySelector( '.atme-name-form [role="status"]' )?.textContent ).toBe( 'Folder already exists' ) );
		fillName( 'Campaigns 2' );
		clickAction( 'Create folder' );
		await vi.waitFor( () => expect( root.querySelector( '.atme-name-form' ) ).toBeNull() );
		expect( mocks.create ).toHaveBeenLastCalledWith( 'Campaigns 2', 0 );
	} );

	it( 'explains deletion and sends no delete after cancellation', async () => {
		row().click();
		mocks.confirm.mockResolvedValue( false );
		clickAction( 'Delete folder…' );
		await Promise.resolve();
		expect( mocks.confirm ).toHaveBeenCalledWith( expect.objectContaining( {
			message: 'Delete “Products”? Media files will stay in the library. Subfolders will move up one level.',
		} ) );
		expect( mocks.delete ).not.toHaveBeenCalled();
		expect( row() ).not.toBeNull();
	} );

	it( 'shows deletion progress, removes the row and returns to the parent', async () => {
		row().click();
		const removal = deferred< void >();
		mocks.confirm.mockResolvedValue( true );
		mocks.delete.mockReturnValue( removal.promise );
		mocks.folders.mockResolvedValue( [ { id: 9, name: 'Summer', parent: 0, count: 1 } ] );
		clickAction( 'Delete folder…' );
		await vi.waitFor( () => expect( mocks.delete ).toHaveBeenCalledWith( 7 ) );
		expect( row().textContent ).toContain( 'Deleting…' );
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( status().textContent ).toBe( 'Deleting “Products”…' );
		removal.resolve();
		await vi.waitFor( () => expect( row() ).toBeNull() );
		expect( root.querySelector( '[data-folder-id="9"]' ) ).not.toBeNull();
		await vi.waitFor( () => expect( status().textContent ).toContain( 'Media files were kept.' ) );
		expect( mocks.media ).toHaveBeenLastCalledWith( expect.objectContaining( { folder: 0 } ), 1 );
	} );

	it( 'keeps the folder after a failed deletion and allows retry', async () => {
		row().click();
		mocks.confirm.mockResolvedValue( true );
		mocks.delete.mockRejectedValueOnce( new Error( 'Permission denied' ) ).mockResolvedValueOnce( undefined );
		clickAction( 'Delete folder…' );
		await vi.waitFor( () => expect( status().textContent ).toContain( 'Could not delete' ) );
		expect( row().getAttribute( 'aria-busy' ) ).toBe( 'false' );
		mocks.folders.mockResolvedValue( [] );
		clickAction( 'Delete folder…' );
		await vi.waitFor( () => expect( row() ).toBeNull() );
		expect( mocks.delete ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'does not delete while a drop is still saving', async () => {
		row().click();
		const save = deferred< { filed: number } >();
		mocks.file.mockReturnValue( save.promise );
		const done = drop();
		mocks.confirm.mockResolvedValue( true );
		clickAction( 'Delete folder…' );
		await vi.waitFor( () => expect( mocks.notify ).toHaveBeenCalled() );
		expect( mocks.delete ).not.toHaveBeenCalled();
		save.resolve( { filed: 1 } );
		await done;
	} );
} );
