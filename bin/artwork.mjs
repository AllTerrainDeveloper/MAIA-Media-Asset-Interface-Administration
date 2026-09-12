/** Render the editable AllTerrain-family SVG masters to WordPress.org sizes. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { pngSize } from './directory-assets.mjs';

const check = process.argv.includes( '--check' );

const root = fileURLToPath( new URL( '../', import.meta.url ) );
mkdirSync( `${ root }.wordpress-org`, { recursive: true } );
for ( const [ name, widths ] of [ [ 'banner', [ 1544, 772 ] ], [ 'icon', [ 256, 128 ] ] ] ) {
	const svg = readFileSync( `${ root }docs/artwork/${ name }.svg`, 'utf8' );
	for ( const width of widths ) {
		const renderer = new Resvg( svg, {
			fitTo: { mode: 'width', value: width },
			font: {
				loadSystemFonts: false,
				fontFiles: [ `${ root }docs/artwork/fonts/Fraunces.ttf`, `${ root }docs/artwork/fonts/DMSans.ttf` ],
			},
		} );
		const rendered = renderer.render();
		const filename = `${ name }-${ rendered.width }x${ rendered.height }.png`;
		const path = `${ root }.wordpress-org/${ filename }`;
		if ( ! check ) {
			writeFileSync( path, rendered.asPng() );
			console.log( `Rendered ${ filename }` );
			continue;
		}

		// Compare pixels rather than PNG bytes: rotated edges can round differently
		// on ARM/macOS and x64/Linux. Small channel changes are not a design change.
		const png = readFileSync( path );
		const [ w, h ] = pngSize( png );
		if ( w !== rendered.width || h !== rendered.height ) {
			throw new Error( `${ filename } has the wrong dimensions.` );
		}
		const reference = new Resvg( `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${ w }" height="${ h }"><image width="${ w }" height="${ h }" xlink:href="data:image/png;base64,${ png.toString( 'base64' ) }"/></svg>` ).render().pixels;
		const actual = rendered.pixels;
		let changed = 0;
		for ( let i = 0; i < actual.length; i += 4 ) {
			if ( [ 0, 1, 2, 3 ].some( ( channel ) => Math.abs( actual[ i + channel ] - reference[ i + channel ] ) > 8 ) ) changed++;
		}
		const fraction = changed / ( w * h );
		console.log( `Checked ${ filename }: ${ ( fraction * 100 ).toFixed( 4 ) }% changed pixels` );
		if ( fraction > 0.001 ) {
			throw new Error( `${ filename } does not match its SVG source. Run npm run artwork:build and review the export.` );
		}
	}
}
