import { defineConfig } from 'vite';

/**
 * Two bundles, four passes.
 *
 * `explorer` is the native window's script — grid, inspector, folders, wizard,
 * Quick Look. `shell` is the tiny eager bundle every desktop user pays for at
 * boot: the WP Explorer preview action, the file opener, the ⌘K commands and
 * the dock-tile drop handler. They are separate because they load on different
 * schedules — the explorer when its window opens, the shell hooks while the
 * desktop is painting — and a single bundle would mean every boot paying for a
 * grid nobody opened.
 *
 * Each target builds twice: `--mode development` emits the readable file
 * WordPress serves under `SCRIPT_DEBUG`, `--mode production` the minified one.
 * `emptyOutDir` is off so the second pass does not delete the first pass's
 * output — and so `explorer` does not delete `shell`.
 *
 * Which target a pass builds comes from `ATME_TARGET`, because Vite's library
 * mode takes one entry per config.
 */
const TARGETS = {
	explorer: {
		entry: 'src/index.ts',
		fileBase: 'explorer',
		iifeName: 'allTerrainMediaExplorer',
	},
	shell: {
		entry: 'src/shell.ts',
		fileBase: 'shell',
		iifeName: 'allTerrainMediaExplorerShell',
	},
	codec: {
		entry: 'src/codec.ts',
		fileBase: 'codec',
		iifeName: 'allTerrainMediaExplorerCodec',
	},
};

export default defineConfig( ( { mode } ) => {
	const name = process.env.ATME_TARGET || 'explorer';
	const target = TARGETS[ name ];

	if ( ! target ) {
		throw new Error(
			`Unknown ATME_TARGET "${ name }". Expected one of: ${ Object.keys( TARGETS ).join( ', ' ) }.`
		);
	}

	const isProd = mode === 'production';

	return {
		plugins: [
			{
				// The jSquash emscripten glue carries a Cloudflare-Workers shim
				// that *assigns* to `import.meta.url`. Rollup rewrites the read
				// into an expression, which turns the assignment into a syntax
				// error — and the shim only matters in environments this bundle
				// never runs in, so it is stripped rather than worked around.
				name: 'atme-strip-emscripten-import-meta-assignment',
				transform( code, id ) {
					if ( ! id.includes( 'avif_enc' ) ) {
						return null;
					}

					return code.replace(
						'if(import.meta.url===undefined){import.meta.url="https://localhost"}',
						''
					);
				},
			},
		],
		build: {
			outDir: 'assets/js',
			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: target.entry,
				formats: [ 'iife' ],
				name: target.iifeName,
				fileName: () => `${ target.fileBase }${ isProd ? '.min' : '' }.js`,
			},
		},
		test: {
			environment: 'jsdom',
			include: [ 'tests/vitest/**/*.test.ts' ],
		},
	};
} );
