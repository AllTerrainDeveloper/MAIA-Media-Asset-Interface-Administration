/** Render the editable AllTerrain-family SVG masters to WordPress.org sizes. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

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
		writeFileSync( `${ root }.wordpress-org/${ filename }`, rendered.asPng() );
		console.log( `Rendered ${ filename }` );
	}
}
