/**
 * "Open in AllTerrain MAIA" from a WP Explorer media preview.
 *
 * The bug this pins: the handler read `mediaId`/`postId`, which WP Explorer
 * never sends, so AllTerrain MAIA opened with nothing in it. The context's
 * real fields are `itemId` and `item.id`.
 */

import { describe, expect, it } from 'vitest';
import { previewActionMediaId } from '../../src/preview-action';

describe( 'previewActionMediaId', () => {
	it( 'reads WP Explorer\'s itemId', () => {
		expect( previewActionMediaId( { itemId: 42, item: { id: 42 } } ) ).toBe( 42 );
	} );

	it( 'falls back to the item record\'s id', () => {
		expect( previewActionMediaId( { item: { id: '17' } } ) ).toBe( 17 );
	} );

	it( 'returns 0 when there is no usable id', () => {
		expect( previewActionMediaId( undefined ) ).toBe( 0 );
		expect( previewActionMediaId( {} ) ).toBe( 0 );
		expect( previewActionMediaId( { item: { id: 'abc' } } ) ).toBe( 0 );
		expect( previewActionMediaId( { itemId: -3 } ) ).toBe( 0 );
	} );
} );
