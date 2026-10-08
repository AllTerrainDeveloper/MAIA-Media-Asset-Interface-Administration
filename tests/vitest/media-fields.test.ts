import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMedia } from '../../src/api';
import type { LibraryQuery } from '../../src/types';

const query = { search: '', kind: '', folder: 0, view: 'all', orderby: 'date', order: 'desc' } as unknown as LibraryQuery;

const size = ( name: string, width: number, height: number ) => ( {
	file: `${ name }.png`,
	width,
	height,
	source_url: `https://example.test/uploads/photo-${ width }x${ height }.png`,
} );

/** A row shaped like core's `/wp/v2/media` answer to the `_fields` list. */
function row( id: number, details: Record< string, unknown >, mediaType = 'image' ) {
	return {
		id,
		mime_type: 'image/png',
		media_type: mediaType,
		source_url: `https://example.test/uploads/photo-${ id }.png`,
		media_details: details,
	};
}

function respond( rows: unknown[] ) {
	const fetch = vi.fn().mockResolvedValue( new Response( JSON.stringify( rows ), {
		status: 200,
		headers: { 'Content-Type': 'application/json', 'X-WP-Total': String( rows.length ), 'X-WP-TotalPages': '1' },
	} ) );

	vi.stubGlobal( 'fetch', fetch );

	return fetch;
}

beforeEach( () => {
	( window as unknown as Record< string, unknown > ).allTerrainMediaExplorer = {
		restUrl: 'https://example.test/wp-json/atme/v1',
		wpRestUrl: 'https://example.test/wp-json/wp/v2',
		nonce: 'nonce',
	};
	vi.stubGlobal( 'devicePixelRatio', 1 );
} );

afterEach( () => {
	vi.unstubAllGlobals();
	delete ( window as unknown as Record< string, unknown > ).allTerrainMediaExplorer;
} );

describe( 'library rows', () => {
	it( 'asks for media_details whole, because core ignores nested paths into it', async () => {
		const fetch = respond( [] );

		await fetchMedia( query );

		const fields = new URL( fetch.mock.calls[ 0 ][ 0 ] as string ).searchParams.get( '_fields' )!.split( ',' );

		expect( fields ).toContain( 'media_details' );
		expect( fields.filter( ( field ) => field.startsWith( 'media_details.' ) ) ).toEqual( [] );
	} );

	it( 'previews a large image with the smallest generated size that fills a tile', async () => {
		respond( [ row( 1, {
			width: 4296,
			height: 4284,
			filesize: 9_000_000,
			sizes: {
				thumbnail: size( 'thumbnail', 150, 150 ),
				medium: size( 'medium', 300, 299 ),
				large: size( 'large', 1024, 1021 ),
				full: size( 'full', 4296, 4284 ),
			},
		} ) ] );

		const { items: [ item ] } = await fetchMedia( query );

		expect( item.thumbnail ).toBe( 'https://example.test/uploads/photo-300x299.png' );
		expect( [ item.width, item.height, item.bytes ] ).toEqual( [ 4296, 4284, 9_000_000 ] );
	} );

	it( 'reaches for a bigger size when a panorama would leave the square tile soft', async () => {
		respond( [ row( 2, {
			width: 4000,
			height: 1000,
			sizes: {
				medium: size( 'medium', 300, 75 ),
				medium_large: size( 'medium_large', 768, 192 ),
				large: size( 'large', 1024, 256 ),
			},
		} ) ] );

		const { items: [ item ] } = await fetchMedia( query );

		expect( item.thumbnail ).toBe( 'https://example.test/uploads/photo-1024x256.png' );
	} );

	it( 'never falls back to a huge original while any generated size exists', async () => {
		vi.stubGlobal( 'devicePixelRatio', 2 );
		respond( [ row( 3, {
			width: 4000,
			height: 3000,
			sizes: { thumbnail: size( 'thumbnail', 150, 150 ), medium: size( 'medium', 300, 225 ) },
		} ) ] );

		const { items: [ item ] } = await fetchMedia( query );

		expect( item.thumbnail ).toBe( 'https://example.test/uploads/photo-300x225.png' );
	} );

	it( 'prefers a small original over its upscaled thumbnail', async () => {
		respond( [ row( 4, { width: 250, height: 250, sizes: { thumbnail: size( 'thumbnail', 150, 150 ) } } ) ] );

		const { items: [ item ] } = await fetchMedia( query );

		expect( item.thumbnail ).toBe( 'https://example.test/uploads/photo-4.png' );
	} );

	it( 'shows the original only when WordPress generated no sizes, and nothing for files', async () => {
		respond( [ row( 5, {} ), row( 6, {}, 'file' ) ] );

		const { items } = await fetchMedia( query );

		expect( items.map( ( item ) => item.thumbnail ) ).toEqual( [ 'https://example.test/uploads/photo-5.png', '' ] );
	} );
} );
