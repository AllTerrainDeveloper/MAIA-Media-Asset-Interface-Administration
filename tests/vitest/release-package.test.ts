// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkDirectoryAssets } from '../../bin/directory-assets.mjs';

const root = resolve( import.meta.dirname, '../..' );
const fixtures: string[] = [];

function fixture(): string {
	const dir = mkdtempSync( join( tmpdir(), 'maia-release-' ) );
	fixtures.push( dir );
	for ( const name of [ 'bin', '.wordpress-org' ] ) {
		cpSync( join( root, name ), join( dir, name ), { recursive: true, filter: ( path ) => ! path.includes( 'phpunit' ) } );
	}
	for ( const name of [ 'package.json', 'package-lock.json', 'readme.txt', 'allterrain-media-explorer.php', 'LICENSE' ] ) {
		cpSync( join( root, name ), join( dir, name ) );
	}
	mkdirSync( join( dir, 'assets/js' ), { recursive: true } );
	mkdirSync( join( dir, 'assets/css' ), { recursive: true } );
	for ( const target of [ 'explorer', 'shell', 'codec' ] ) {
		for ( const suffix of [ '', '.min' ] ) {
			writeFileSync( join( dir, `assets/js/${ target }${ suffix }.js` ), '// Fixture bundle\n' );
		}
	}
	writeFileSync( join( dir, 'assets/css/allterrain-media-explorer.css' ), '/* Fixture CSS */' );
	return dir;
}

afterEach( () => { for ( const dir of fixtures.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } ); } );

describe( 'WordPress.org package', () => {
	it( 'keeps listing art, fonts and development guidance outside the installable ZIP', () => {
		const dir = fixture();
		mkdirSync( join( dir, 'docs/artwork/fonts' ), { recursive: true } );
		writeFileSync( join( dir, 'docs/artwork/fonts/test.ttf' ), 'development only' );
		writeFileSync( join( dir, 'AGENTS.md' ), 'development only' );
		writeFileSync( join( dir, 'assets/.DS_Store' ), 'finder metadata' );
		const result = spawnSync( 'node', [ 'bin/package.mjs' ], { cwd: dir, encoding: 'utf8' } );
		expect( result.stderr ).toBe( '' );
		expect( result.status ).toBe( 0 );
		const contents = spawnSync( 'unzip', [ '-Z1', 'dist/allterrain-media-explorer.zip' ], { cwd: dir, encoding: 'utf8' } ).stdout;
		expect( contents ).toContain( 'allterrain-media-explorer/allterrain-media-explorer.php' );
		expect( contents ).toContain( 'allterrain-media-explorer/assets/js/codec.min.js' );
		expect( contents ).not.toMatch( /AGENTS|docs\/|\.wordpress-org|package\.json|bin\/|\.DS_Store/ );
		expect( readdirSync( join( dir, 'dist/assets' ) ) ).toHaveLength( 8 );
	} );

	it( 'rejects package-lock version drift before replacing the last package', () => {
		const dir = fixture();
		const lock = JSON.parse( readFileSync( join( dir, 'package-lock.json' ), 'utf8' ) );
		lock.packages[ '' ].version = '99.0.0';
		writeFileSync( join( dir, 'package-lock.json' ), JSON.stringify( lock ) );
		mkdirSync( join( dir, 'dist' ) );
		writeFileSync( join( dir, 'dist/previous.zip' ), 'keep' );
		const result = spawnSync( 'node', [ 'bin/package.mjs' ], { cwd: dir, encoding: 'utf8' } );
		expect( result.status ).toBe( 1 );
		expect( result.stderr ).toContain( 'Version mismatch' );
		expect( readFileSync( join( dir, 'dist/previous.zip' ), 'utf8' ) ).toBe( 'keep' );
	} );

	it( 'rejects renamed artwork with the wrong actual dimensions', () => {
		const dir = fixture();
		cpSync( join( dir, '.wordpress-org/icon-128x128.png' ), join( dir, '.wordpress-org/icon-256x256.png' ) );
		expect( () => checkDirectoryAssets( dir ) ).toThrow( 'Wrong dimensions' );
	} );

	it( 'rejects a missing listing screenshot', () => {
		const dir = fixture();
		rmSync( join( dir, '.wordpress-org/screenshot-2.png' ) );
		expect( () => checkDirectoryAssets( dir ) ).toThrow();
	} );

	it( 'rejects uncaptioned screenshots and accidentally staged source files', () => {
		const dir = fixture();
		writeFileSync( join( dir, '.wordpress-org/source.svg' ), '<svg/>' );
		expect( () => checkDirectoryAssets( dir ) ).toThrow( 'Unexpected directory asset' );
	} );

	it( 'rejects caption numbering gaps', () => {
		const dir = fixture();
		const path = join( dir, 'readme.txt' );
		writeFileSync( path, readFileSync( path, 'utf8' ).replace( '2. Open a photo', '9. Open a photo' ) );
		expect( () => checkDirectoryAssets( dir ) ).toThrow( 'consecutive numbered' );
	} );

	it( 'rejects files that merely have a PNG extension', () => {
		const dir = fixture();
		writeFileSync( join( dir, '.wordpress-org/screenshot-1.png' ), 'Not a PNG' );
		expect( () => checkDirectoryAssets( dir ) ).toThrow( 'Expected a PNG' );
	} );
} );

describe( 'release helpers', () => {
	it( 'checks artwork without rewriting it and rejects a changed banner title', () => {
		const dir = fixture();
		cpSync( join( root, 'docs/artwork' ), join( dir, 'docs/artwork' ), { recursive: true } );
		symlinkSync( join( root, 'node_modules' ), join( dir, 'node_modules' ), 'dir' );
		const imagePath = join( dir, '.wordpress-org/banner-1544x500.png' );
		const before = readFileSync( imagePath );
		const run = () => spawnSync( 'node', [ 'bin/artwork.mjs', '--check' ], { cwd: dir, encoding: 'utf8' } );
		expect( run().status ).toBe( 0 );
		const source = join( dir, 'docs/artwork/banner.svg' );
		writeFileSync( source, readFileSync( source, 'utf8' ).replace( 'YOUR MEDIA', 'WRONG COPY' ) );
		const result = run();
		expect( result.status ).toBe( 1 );
		expect( result.stderr ).toContain( 'does not match its SVG source' );
		expect( readFileSync( imagePath ).equals( before ) ).toBe( true );
	} );

	it.each( [ '1.2.3', '1.2.3-rc1' ] )( 'bumps every version to %s even when called outside the repository', ( version ) => {
		const dir = fixture();
		const result = spawnSync( 'bash', [ join( dir, 'bin/bump-version.sh' ), version ], { cwd: tmpdir(), encoding: 'utf8' } );
		expect( result.status, result.stderr ).toBe( 0 );
		const php = readFileSync( join( dir, 'allterrain-media-explorer.php' ), 'utf8' );
		expect( /^\s*\*\s*Version:\s*(.+)$/m.exec( php )?.[ 1 ] ).toBe( version );
		expect( php ).toContain( `'ATME_VERSION', '${ version }'` );
		expect( readFileSync( join( dir, 'readme.txt' ), 'utf8' ) ).toContain( `Stable tag: ${ version }` );
		expect( JSON.parse( readFileSync( join( dir, 'package.json' ), 'utf8' ) ).version ).toBe( version );
		const lock = JSON.parse( readFileSync( join( dir, 'package-lock.json' ), 'utf8' ) );
		expect( lock.version ).toBe( version );
		expect( lock.packages[ '' ].version ).toBe( version );
	}, 15000 );

	it( 'rejects malformed release versions before authentication or any file changes', () => {
		const dir = fixture();
		const before = readFileSync( join( dir, 'package.json' ), 'utf8' );
		for ( const script of [ 'release.sh', 'bump-version.sh' ] ) {
			const result = spawnSync( 'bash', [ join( dir, 'bin', script ), 'v1.2.3;exit' ], { cwd: tmpdir(), encoding: 'utf8' } );
			expect( result.status ).toBe( 1 );
			expect( result.stderr ).toMatch( /expected X\.Y\.Z/i );
		}
		expect( readFileSync( join( dir, 'package.json' ), 'utf8' ) ).toBe( before );
	} );
} );
