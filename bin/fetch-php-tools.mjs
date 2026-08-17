/**
 * Fetches the PHP test toolchain — without Composer.
 *
 * This plugin's rule is "no Composer, anywhere", and the test stack is the
 * one place that usually smuggles it back in: WordPress's test library
 * requires the Yoast PHPUnit Polyfills, and PHPUnit itself normally arrives
 * via vendor/bin. Both are available without a package manager — PHPUnit as
 * the project's own signed PHAR, the polyfills as a plain GitHub tarball
 * with a ready-made `phpunitpolyfills-autoload.php` at its root — so this
 * script downloads exactly those two artifacts into `bin/` (never shipped:
 * `ships.mjs` excludes bin/) and `test-php.mjs` points the WordPress
 * bootstrap at them.
 *
 * Idempotent: existing downloads are kept. `--force` refetches.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
const phar = join( root, 'bin', 'phpunit.phar' );
const polyfillsDir = join( root, 'bin', 'phpunit-polyfills' );

// PHPUnit 9 is the newest line WordPress core's test library supports.
const PHPUNIT_URL = 'https://phar.phpunit.de/phpunit-9.6.29.phar';
// 1.1.5 + PHPUnit 9.6 is the exact pairing wordpress-develop itself pins,
// and the one this suite runs against locally. Newer polyfills lines target
// newer PHPUnit majors than WordPress's test library supports.
const POLYFILLS_URL =
	'https://github.com/Yoast/PHPUnit-Polyfills/archive/refs/tags/1.1.5.tar.gz';

const force = process.argv.includes( '--force' );

if ( force ) {
	rmSync( phar, { force: true } );
	rmSync( polyfillsDir, { recursive: true, force: true } );
}

if ( ! existsSync( phar ) ) {
	process.stdout.write( `[php-tools] Fetching ${ PHPUNIT_URL }\n` );
	execFileSync( 'curl', [ '-fsSL', '-o', phar, PHPUNIT_URL ], { stdio: 'inherit' } );
}

if ( ! existsSync( join( polyfillsDir, 'phpunitpolyfills-autoload.php' ) ) ) {
	process.stdout.write( `[php-tools] Fetching ${ POLYFILLS_URL }\n` );
	mkdirSync( polyfillsDir, { recursive: true } );
	execFileSync(
		'bash',
		[ '-c', `curl -fsSL '${ POLYFILLS_URL }' | tar xz --strip-components=1 -C '${ polyfillsDir }'` ],
		{ stdio: 'inherit' }
	);
}

process.stdout.write( '[php-tools] Ready: bin/phpunit.phar + bin/phpunit-polyfills/\n' );
