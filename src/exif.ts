/**
 * EXIF, read where the pixels already are: the browser.
 *
 * exifr (MIT) parses just the header bytes over a ranged fetch, so a
 * 12-megapixel photo costs kilobytes. Everything degrades to "no facts" —
 * a stripped file, a PNG, a CORS-refused URL all simply add no rows.
 */

import exifr from 'exifr';

export interface ExifFacts {
	camera: string;
	exposure: string;
	taken: string;
}

/** The interesting subset, formatted for the facts list. */
export async function readExif( url: string ): Promise< ExifFacts | null > {
	const data = ( await exifr.parse( url, {
		pick: [ 'Make', 'Model', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'DateTimeOriginal' ],
	} ) ) as Record< string, unknown > | undefined;

	if ( ! data ) {
		return null;
	}

	const make = String( data.Make ?? '' ).trim();
	const model = String( data.Model ?? '' ).trim();
	// Most vendors repeat the make inside the model.
	const camera = model.toLowerCase().startsWith( make.toLowerCase() ) ? model : `${ make } ${ model }`.trim();

	const parts: string[] = [];
	const exposure = Number( data.ExposureTime ?? 0 );

	if ( exposure > 0 ) {
		parts.push( exposure >= 1 ? `${ exposure }s` : `1/${ Math.round( 1 / exposure ) }s` );
	}

	if ( data.FNumber ) {
		parts.push( `ƒ/${ data.FNumber }` );
	}

	if ( data.ISO ) {
		parts.push( `ISO ${ data.ISO }` );
	}

	if ( data.FocalLength ) {
		parts.push( `${ data.FocalLength }mm` );
	}

	const taken = data.DateTimeOriginal instanceof Date ? data.DateTimeOriginal.toLocaleString() : '';

	if ( ! camera && parts.length === 0 && ! taken ) {
		return null;
	}

	return { camera, exposure: parts.join( ' · ' ), taken };
}
