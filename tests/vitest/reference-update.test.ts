import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceUpdate as UpdateResult, UsageRow } from '../../src/types';
const mocks = vi.hoisted( () => ( { candidates: vi.fn(), update: vi.fn() } ) );
vi.mock( '../../src/api', () => ( {
	fetchReferenceCandidates: mocks.candidates,
	updatePostReferences: mocks.update,
} ) );
import { offerReferenceUpdate } from '../../src/reference-update';

const row = ( postId: number ) => ( { postId, title: `Post ${ postId }`, type: 'post', typeLabel: 'Post', usedAs: 'content', editUrl: '' } as UsageRow );
const done = ( postId: number, replaced = 2 ) => ( { postId, title: `Post ${ postId }`, replaced, featured: false, changed: true } as UpdateResult );
const flush = async () => { for ( let i = 0; i < 10; i++ ) { await Promise.resolve(); } };
const dialog = () => document.body.querySelector( 'dialog' );
const rows = () => Array.from( document.body.querySelectorAll< HTMLElement >( '.atme-refupdate__row' ) );
const statuses = () => rows().map( ( el ) => el.dataset.status );
const button = ( label: string ) => Array.from( document.body.querySelectorAll( 'button' ) ).find( ( el ) => el.textContent?.startsWith( label ) )!;

/** A promise the test resolves by hand, to watch one post at a time. */
function deferred< T >() {
	let resolve!: ( value: T ) => void;
	let reject!: ( error: Error ) => void;
	const promise = new Promise< T >( ( res, rej ) => { resolve = res; reject = rej; } );
	return { promise, resolve, reject };
}

afterEach( () => { vi.clearAllMocks(); document.body.replaceChildren(); } );

describe( 'post reference update after a conversion', () => {
	it( 'stays shut when nothing uses the old file', async () => {
		mocks.candidates.mockResolvedValue( [] );
		offerReferenceUpdate( { pairs: [ { from: 1, to: 2 } ], format: 'webp' } );
		await flush();
		expect( dialog() ).toBeNull();
	} );

	it( 'offers every affected post and changes nothing until asked', async () => {
		mocks.candidates.mockResolvedValue( [ row( 10 ), row( 11 ) ] );
		offerReferenceUpdate( { pairs: [ { from: 1, to: 2 } ], format: 'webp' } );
		await flush();
		expect( dialog()!.textContent ).toContain( 'Use the WebP in your posts?' );
		expect( statuses() ).toEqual( [ 'pending', 'pending' ] );
		expect( mocks.update ).not.toHaveBeenCalled();
		button( 'Not now' ).click();
		expect( dialog() ).toBeNull();
		expect( mocks.update ).not.toHaveBeenCalled();
	} );

	it( 'updates one post at a time and shows each one land', async () => {
		const first = deferred< UpdateResult >();
		const second = deferred< UpdateResult >();
		mocks.candidates.mockResolvedValue( [ row( 10 ), row( 11 ) ] );
		mocks.update.mockReturnValueOnce( first.promise ).mockReturnValueOnce( second.promise );
		const onFinished = vi.fn();
		offerReferenceUpdate( { pairs: [ { from: 1, to: 2 } ], format: 'webp', onFinished } );
		await flush();
		button( 'Update 2 posts' ).click();
		await flush();
		expect( statuses() ).toEqual( [ 'working', 'pending' ] );
		expect( mocks.update ).toHaveBeenCalledTimes( 1 );
		expect( mocks.update ).toHaveBeenCalledWith( 10, 1, 2, 'post' );
		expect( document.body.querySelector( '[role="status"]' )!.textContent ).toBe( 'Updating 1 of 2: Post 10' );
		first.resolve( done( 10 ) );
		await flush();
		expect( statuses() ).toEqual( [ 'done', 'working' ] );
		expect( rows()[ 0 ].textContent ).toContain( '2 links updated' );
		second.reject( new Error( 'Sorry, you are not allowed to edit this post.' ) );
		await flush();
		expect( statuses() ).toEqual( [ 'done', 'failed' ] );
		expect( rows()[ 1 ].textContent ).toContain( 'Sorry, you are not allowed to edit this post.' );
		expect( document.body.querySelector( '[role="status"]' )!.textContent ).toBe( '1 post updated · 1 failed' );
		expect( onFinished ).toHaveBeenCalledTimes( 1 );

		// Retry runs only what failed.
		mocks.update.mockResolvedValueOnce( done( 11, 1 ) );
		button( 'Retry 1 failed post' ).click();
		await flush();
		expect( mocks.update ).toHaveBeenLastCalledWith( 11, 1, 2, 'post' );
		expect( statuses() ).toEqual( [ 'done', 'done' ] );
	} );

	it( 'groups a post that uses several converted files into one row', async () => {
		mocks.candidates.mockImplementation( async ( from: number ) => ( 1 === from ? [ row( 10 ) ] : [ row( 10 ), row( 12 ) ] ) );
		mocks.update.mockImplementation( async ( post: number ) => done( post, 1 ) );
		offerReferenceUpdate( { pairs: [ { from: 1, to: 2 }, { from: 3, to: 4 } ], format: 'avif' } );
		await flush();
		expect( rows() ).toHaveLength( 2 );
		button( 'Update 2 posts' ).click();
		await flush();
		expect( mocks.update.mock.calls ).toEqual( [ [ 10, 1, 2, 'post' ], [ 10, 3, 4, 'post' ], [ 12, 3, 4, 'post' ] ] );
		expect( rows()[ 0 ].textContent ).toContain( '2 links updated' );
	} );

	it( 'stops after the post in flight and skips the rest', async () => {
		const first = deferred< UpdateResult >();
		mocks.candidates.mockResolvedValue( [ row( 10 ), row( 11 ), row( 12 ) ] );
		mocks.update.mockReturnValueOnce( first.promise );
		offerReferenceUpdate( { pairs: [ { from: 5, to: 5 } ], format: 'webp' } );
		await flush();
		button( 'Update 3 posts' ).click();
		await flush();
		button( 'Stop' ).click();
		first.resolve( done( 10 ) );
		await flush();
		expect( statuses() ).toEqual( [ 'done', 'skipped', 'skipped' ] );
		expect( mocks.update ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'ignores answers that arrive after teardown', async () => {
		const first = deferred< UpdateResult >();
		mocks.candidates.mockResolvedValue( [ row( 10 ), row( 11 ) ] );
		mocks.update.mockReturnValueOnce( first.promise );
		const handle = offerReferenceUpdate( { pairs: [ { from: 1, to: 2 } ], format: 'webp' } );
		await flush();
		button( 'Update 2 posts' ).click();
		await flush();
		handle.destroy();
		first.resolve( done( 10 ) );
		await flush();
		expect( dialog() ).toBeNull();
		expect( mocks.update ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'never opens when torn down before the lookup returns', async () => {
		const lookup = deferred< UsageRow[] >();
		mocks.candidates.mockReturnValue( lookup.promise );
		const handle = offerReferenceUpdate( { pairs: [ { from: 1, to: 2 } ], format: 'webp' } );
		handle.destroy();
		lookup.resolve( [ row( 10 ) ] );
		await flush();
		expect( dialog() ).toBeNull();
	} );
} );
