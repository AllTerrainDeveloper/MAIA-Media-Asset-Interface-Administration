/** Validate the PNG files uploaded to WordPress.org, independently of the ZIP. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Read dimensions from PNG's required first chunk, rejecting mislabeled files. */
export function pngSize( bytes ) {
	if ( bytes.length < 33 || ! bytes.subarray( 0, 8 ).equals( Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ) ) || bytes.toString( 'ascii', 12, 16 ) !== 'IHDR' ) {
		throw new Error( 'Expected a PNG with an IHDR chunk.' );
	}
	return [ bytes.readUInt32BE( 16 ), bytes.readUInt32BE( 20 ) ];
}

/** Require both artwork resolutions and one actual image per listing caption. */
export function checkDirectoryAssets( root ) {
	const dir = join( root, '.wordpress-org' );
	const listing = readFileSync( join( root, 'readme.txt' ), 'utf8' );
	const section = /== Screenshots ==\s*\n([\s\S]*?)(?=\n== |$)/.exec( listing )?.[ 1 ] || '';
	const captions = [ ...section.matchAll( /^(\d+)\.\s+\S.+$/gm ) ];
	if ( ! captions.length || captions.some( ( match, i ) => Number( match[ 1 ] ) !== i + 1 ) ) {
		throw new Error( 'readme.txt needs consecutive numbered screenshot captions starting at 1.' );
	}
	const expected = new Map( [
		[ 'banner-772x250.png', [ 772, 250, 4 ] ],
		[ 'banner-1544x500.png', [ 1544, 500, 4 ] ],
		[ 'icon-128x128.png', [ 128, 128, 1 ] ],
		[ 'icon-256x256.png', [ 256, 256, 1 ] ],
		...captions.map( ( _, i ) => [ `screenshot-${ i + 1 }.png`, [ 0, 0, 10 ] ] ),
	] );
	const names = readdirSync( dir );
	for ( const name of names ) {
		if ( ! expected.has( name ) ) {
			throw new Error( `Unexpected directory asset: ${ name }. Keep design sources under docs/artwork/.` );
		}
	}
	for ( const [ name, [ width, height, limit ] ] of expected ) {
		const path = join( dir, name );
		const [ actualWidth, actualHeight ] = pngSize( readFileSync( path ) );
		if ( ! actualWidth || ! actualHeight || ( width && ( width !== actualWidth || height !== actualHeight ) ) ) {
			throw new Error( `Wrong dimensions for ${ name }: ${ actualWidth }x${ actualHeight }.` );
		}
		if ( statSync( path ).size > limit * 1024 * 1024 ) {
			throw new Error( `${ name } exceeds WordPress.org's ${ limit }MB limit.` );
		}
	}
	return names;
}
