import { afterEach, describe, expect, it, vi } from 'vitest';
import { restEndpoint } from '../../src/api';
import { suggestAltText } from '../../src/ai';
import type { MediaItem } from '../../src/types';

const item = { id: 1, url: 'https://example.test/private.jpg', title: 'Photo', caption: 'Caption' } as MediaItem;
const w = window as unknown as { wp?: unknown };
afterEach( () => { delete w.wp; } );

describe( 'Forms review regressions', () => {
	it.each( [ 'https://example.test/wp-json/wp/v2', 'https://example.test/sub/index.php?rest_route=/wp/v2' ] )( 'builds filtered routes for %s', ( base ) => {
		const url = new URL( restEndpoint( base, '/media?search=one%20%26%20two&include%5B%5D=3&include%5B%5D=4' ) );
		expect( url.searchParams.get( 'search' ) ).toBe( 'one & two' );
		expect( url.searchParams.getAll( 'include[]' ) ).toEqual( [ '3', '4' ] );
		if ( base.includes( 'rest_route' ) ) {
			expect( url.searchParams.get( 'rest_route' ) ).toBe( '/wp/v2/media' );
			expect( url.pathname ).toBe( '/sub/index.php' );
		} else {
			expect( url.pathname ).toBe( '/wp-json/wp/v2/media' );
		}
	} );
	it( 'never sends AI data before consent or after a cancellation', async () => {
		const ask = vi.fn();
		w.wp = { os: { ai: { ask }, confirm: vi.fn().mockResolvedValue( false ) } };
		expect( await suggestAltText( item ) ).toBeNull();
		expect( ask ).not.toHaveBeenCalled();
		w.wp = { os: { ai: { ask } } };
		expect( await suggestAltText( item ) ).toBeNull();
		expect( ask ).not.toHaveBeenCalled();
	} );
	it( 'discloses data, then unwraps the approved AI response', async () => {
		const confirm = vi.fn().mockResolvedValue( true );
		const ask = vi.fn().mockResolvedValue( { message: '"A bird in flight"' } );
		w.wp = { os: { ai: { ask }, confirm } };
		expect( await suggestAltText( item ) ).toBe( 'A bird in flight' );
		expect( confirm.mock.calls[0][0].message ).toContain( 'image URL, title and caption' );
		expect( ask ).toHaveBeenCalledOnce();
		expect( confirm.mock.invocationCallOrder[0] ).toBeLessThan( ask.mock.invocationCallOrder[0] );
	} );
	it( 'rejects malformed AI replies', async () => {
		w.wp = { os: { ai: { ask: vi.fn().mockResolvedValue( { message: {} } ) }, confirm: vi.fn().mockResolvedValue( true ) } };
		await expect( suggestAltText( item ) ).rejects.toThrow( 'usable alt text' );
	} );
} );
