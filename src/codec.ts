/**
 * The browser codec bundle: AVIF encoding in WASM, loaded only when asked.
 *
 * Separate from the explorer bundle on purpose — the encoder is a megabyte
 * of WebAssembly, and a library window that never exports an AVIF should
 * never fetch it. `convert-client.ts` injects this script on first use and
 * calls through `window.atmeCodec`.
 *
 * The codec is jSquash (Apache-2.0, the Squoosh codecs repackaged). The
 * emscripten module is driven directly rather than through the package's
 * `encode.js` wrapper: the wrapper feature-detects threads and reaches for a
 * worker build that needs cross-origin-isolation headers no arbitrary
 * WordPress host can be assumed to send — and whose worker reference breaks
 * a single-file IIFE build outright. Single-threaded, single file, works on
 * any host: the WASM travels inside this bundle as a data URI.
 */

import avifEncFactory from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';
// Vite resolves this to an inline data URI in lib mode, so the bundle is
// self-contained — no second request, no path to misresolve inside wp-admin.
import wasmUrl from '@jsquash/avif/codec/enc/avif_enc.wasm?url';

interface AvifModule {
	encode(
		data: Uint8Array,
		width: number,
		height: number,
		options: typeof defaultOptions
	): { buffer: ArrayBuffer } | null;
}

let modulePromise: Promise< AvifModule > | null = null;

function loadModule(): Promise< AvifModule > {
	if ( ! modulePromise ) {
		modulePromise = ( avifEncFactory as ( opts: object ) => Promise< AvifModule > )( {
			noInitialRun: true,
			locateFile: ( path: string ) => ( path.endsWith( '.wasm' ) ? wasmUrl : path ),
		} );
	}

	return modulePromise;
}

declare global {
	interface Window {
		atmeCodec?: {
			encodeAvif: ( data: ImageData, quality: number ) => Promise< ArrayBuffer >;
		};
	}
}

window.atmeCodec = {
	async encodeAvif( data: ImageData, quality: number ): Promise< ArrayBuffer > {
		const module = await loadModule();
		const output = module.encode(
			new Uint8Array( data.data.buffer ),
			data.width,
			data.height,
			{ ...defaultOptions, quality }
		);

		if ( ! output ) {
			throw new Error( 'AVIF encoding failed.' );
		}

		return output.buffer;
	},
};
