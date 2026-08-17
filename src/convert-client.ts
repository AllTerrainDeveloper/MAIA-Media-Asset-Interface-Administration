/**
 * Converting in the browser, for the cases the server cannot or should not.
 *
 * Two engines, chosen per format:
 *
 *   - **The canvas.** WebP, JPEG and PNG encode natively in every evergreen
 *     browser via `canvas.toBlob` — zero bytes of dependency, works on any
 *     hosting, and never touches the server at all. This is the whole
 *     "Download as…" path for the common formats.
 *   - **The codec bundle.** AVIF has no native encoder yet, so a jSquash
 *     WASM build (assets/js/codec*.js) is script-injected on first use.
 *     Megabytes, hence lazy; single-threaded, hence host-agnostic.
 *
 * Everything here is also the fallback story for hosts whose PHP lacks a
 * format: the server said `encode.avif: false`, the browser does it instead.
 */

import { getConfig } from './api';
import type { MediaItem } from './types';

/** What this browser can produce client-side. Probed once. */
export function browserEncodeSupport(): Record< string, boolean > {
	const canvas = document.createElement( 'canvas' );

	canvas.width = 1;
	canvas.height = 1;

	const webp = canvas.toDataURL( 'image/webp' ).startsWith( 'data:image/webp' );

	return {
		jpeg: true,
		png: true,
		webp,
		// Via the lazy codec bundle, not the canvas.
		avif: typeof WebAssembly !== 'undefined',
	};
}

/** Injects the codec bundle once and resolves when its API exists. */
let codecPromise: Promise< NonNullable< Window[ 'atmeCodec' ] > > | null = null;

declare global {
	interface Window {
		atmeCodec?: {
			encodeAvif: ( data: ImageData, quality: number ) => Promise< ArrayBuffer >;
		};
	}
}

function loadCodec(): Promise< NonNullable< Window[ 'atmeCodec' ] > > {
	if ( window.atmeCodec ) {
		return Promise.resolve( window.atmeCodec );
	}

	if ( ! codecPromise ) {
		codecPromise = new Promise( ( resolve, reject ) => {
			const config = getConfig();
			const script = document.createElement( 'script' );

			// The plugin URL is the REST URL's sibling; derive it from what
			// config already carries rather than adding another field.
			const base = config.restUrl.replace( /wp-json\/.*$/, '' );

			script.src = `${ base }wp-content/plugins/allterrain-media-explorer/assets/js/codec.min.js?ver=${ config.version }`;
			script.async = true;
			script.onload = () => {
				if ( window.atmeCodec ) {
					resolve( window.atmeCodec );
				} else {
					reject( new Error( 'The codec bundle loaded but registered nothing.' ) );
				}
			};
			script.onerror = () => reject( new Error( 'The codec bundle could not be fetched.' ) );
			document.head.appendChild( script );
		} );
	}

	return codecPromise;
}

/** Reads an item's full-size pixels into ImageData. */
async function readPixels( item: MediaItem ): Promise< ImageData > {
	const response = await fetch( item.url, { credentials: 'same-origin' } );

	if ( ! response.ok ) {
		throw new Error( 'The original file could not be fetched.' );
	}

	const bitmap = await createImageBitmap( await response.blob() );
	const canvas = document.createElement( 'canvas' );

	canvas.width = bitmap.width;
	canvas.height = bitmap.height;

	const context = canvas.getContext( '2d' );

	if ( ! context ) {
		throw new Error( 'No 2D context — the browser is out of memory or headless.' );
	}

	context.drawImage( bitmap, 0, 0 );
	bitmap.close();

	return context.getImageData( 0, 0, canvas.width, canvas.height );
}

/** Encodes ImageData in the browser. */
async function encodeInBrowser( data: ImageData, format: string, quality: number ): Promise< Blob > {
	if ( 'avif' === format ) {
		const codec = await loadCodec();
		const buffer = await codec.encodeAvif( data, quality );

		return new Blob( [ buffer ], { type: 'image/avif' } );
	}

	const canvas = document.createElement( 'canvas' );

	canvas.width = data.width;
	canvas.height = data.height;
	canvas.getContext( '2d' )?.putImageData( data, 0, 0 );

	const mime = 'jpeg' === format ? 'image/jpeg' : `image/${ format }`;

	return new Promise( ( resolve, reject ) => {
		canvas.toBlob(
			( blob ) => {
				if ( blob && blob.type === mime ) {
					resolve( blob );
				} else {
					reject( new Error( `This browser cannot encode ${ format.toUpperCase() }.` ) );
				}
			},
			mime,
			quality / 100
		);
	} );
}

/**
 * "Download as…" — converts in the browser and hands the reader the file.
 *
 * No server round trip, no library mutation: the copy exists only in the
 * download. Exactly what "I need this one photo as WebP for a slide deck"
 * wants.
 */
export async function downloadAs( item: MediaItem, format: string, quality = 82 ): Promise< void > {
	const data = await readPixels( item );
	const blob = await encodeInBrowser( data, format, quality );

	const stem = ( item.url.split( '/' ).pop() ?? `media-${ item.id }` ).replace( /\.[a-z0-9]+$/i, '' );
	const link = document.createElement( 'a' );

	link.href = URL.createObjectURL( blob );
	link.download = `${ stem }.${ 'jpeg' === format ? 'jpg' : format }`;
	link.rel = 'noopener';
	link.click();

	// Give the click a beat to begin before the URL dies.
	window.setTimeout( () => URL.revokeObjectURL( link.href ), 10_000 );
}
