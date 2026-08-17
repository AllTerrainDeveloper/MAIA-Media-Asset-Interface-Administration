/**
 * The drag payload, byte-for-byte the shell's shape.
 *
 * These tests are the interop contract: WP Explorer's media grid emits this
 * exact structure, and every drop target on the desktop was written against
 * it. If a key here changes, drops into Gutenberg, kanban cards and image
 * fields silently stop — so the shape is pinned by assertion.
 */

import { describe, expect, it } from 'vitest';
import { attachmentPayload } from '../../src/payloads';
import type { MediaItem } from '../../src/types';

function item( id: number, overrides: Partial< MediaItem > = {} ): MediaItem {
	return {
		id,
		title: `Photo ${ id }`,
		date: '2026-08-01T00:00:00',
		mime: 'image/jpeg',
		kind: 'image',
		url: `http://example.test/wp-content/uploads/photo-${ id }.jpg`,
		thumbnail: `http://example.test/wp-content/uploads/photo-${ id }-300x200.jpg`,
		alt: `Alt ${ id }`,
		caption: '',
		description: '',
		width: 1200,
		height: 800,
		bytes: 123456,
		authorId: 1,
		parent: 0,
		folders: [],
		...overrides,
	};
}

function tile(): HTMLElement {
	const el = document.createElement( 'div' );

	el.getBoundingClientRect = () =>
		( { left: 100, top: 50, width: 148, height: 172, right: 248, bottom: 222, x: 100, y: 50, toJSON: () => ( {} ) } ) as DOMRect;

	return el;
}

function pointer(): PointerEvent {
	return { clientX: 130, clientY: 90 } as PointerEvent;
}

describe( 'attachmentPayload', () => {
	it( "uses the shell's shortcut type, not a private slug", () => {
		const grabbed = item( 7 );
		const payload = attachmentPayload( grabbed, [ grabbed ], tile(), pointer() );

		expect( payload.type ).toBe( 'shortcut' );
	} );

	it( 'carries the grabbed item at the top level, WP Explorer style', () => {
		const grabbed = item( 7 );
		const payload = attachmentPayload( grabbed, [ grabbed ], tile(), pointer() );

		expect( payload.data.kind ).toBe( 'attachment' );
		expect( payload.data.ref ).toBe( '7' );
		expect( payload.data.entityId ).toBe( 'media' );
		expect( payload.data.title ).toBe( 'Photo 7' );
	} );

	it( 'attaches a bridge payload so cross-iframe drops work for free', () => {
		const grabbed = item( 7 );
		const payload = attachmentPayload( grabbed, [ grabbed ], tile(), pointer() );
		const bridge = payload.data.bridgePayload as Record< string, unknown >;

		expect( bridge.kind ).toBe( 'attachment' );
		expect( bridge.id ).toBe( 7 );
		expect( bridge.url ).toBe( grabbed.url );
		expect( bridge.alt ).toBe( 'Alt 7' );
		expect( bridge.mime ).toBe( 'image/jpeg' );
		expect( bridge.thumbnailUrl ).toBe( grabbed.thumbnail );
	} );

	it( 'carries the whole selection under items, so multi-drops resolve', () => {
		const grabbed = item( 7 );
		const set = [ item( 5 ), grabbed, item( 9 ) ];
		const payload = attachmentPayload( grabbed, set, tile(), pointer() );
		const items = payload.data.items as Array< { ref: string } >;

		expect( items.map( ( entry ) => entry.ref ) ).toEqual( [ '5', '7', '9' ] );
	} );

	it( 'measures the ghost offset from the grab point, never 0,0', () => {
		const grabbed = item( 7 );
		const payload = attachmentPayload( grabbed, [ grabbed ], tile(), pointer() );

		expect( payload.ghost?.offsetX ).toBe( 30 );
		expect( payload.ghost?.offsetY ).toBe( 40 );
	} );

	it( 'falls back to the filename when a title is missing', () => {
		const grabbed = item( 7, { title: '' } );
		const payload = attachmentPayload( grabbed, [ grabbed ], tile(), pointer() );

		expect( payload.data.title ).toBe( 'photo-7.jpg' );
	} );
} );
