<?php
/**
 * Script and style handles.
 *
 * Two bundles, because they load on different schedules. The explorer bundle
 * is the native window's `script` — the shell loads it when the window opens.
 * The shell bundle is tiny and eager: it carries the WP Explorer decorations,
 * the file opener behaviour, the commands and the dock-tile drop handler,
 * all of which are filters the shell consults while it paints — a bundle
 * that arrives late has already missed the question.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'atme_register_assets', 5 );

/**
 * Registers every handle.
 *
 * On `init` at 5 so the registrations in `window.php` — which name these
 * handles — can rely on them existing when they run at 20.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_register_assets() {
	$suffix = atme_asset_suffix();

	// Registered first, and named as a dependency by every bundle that reads
	// it. A `false` src is WordPress's supported way to ship inline-only JS: a
	// real handle, with nothing to fetch. Being a *dependency* rather than
	// merely enqueued alongside is what guarantees the config exists before
	// the bundle reads it, whatever order the shell enqueues things in.
	wp_register_script( 'allterrain-media-explorer-config', false, array(), ATME_VERSION, true );
	atme_print_config( 'allterrain-media-explorer-config' );

	wp_register_style(
		'allterrain-media-explorer',
		ATME_URL . 'assets/css/allterrain-media-explorer.css',
		array( 'dashicons' ),
		atme_asset_version( 'assets/css/allterrain-media-explorer.css' )
	);

	wp_register_script(
		'allterrain-media-explorer',
		ATME_URL . "assets/js/explorer{$suffix}.js",
		array( 'wp-hooks', 'allterrain-media-explorer-config' ),
		atme_asset_version( "assets/js/explorer{$suffix}.js" ),
		true
	);

	wp_register_script(
		'allterrain-media-explorer-shell',
		ATME_URL . "assets/js/shell{$suffix}.js",
		array( 'wp-hooks', 'allterrain-media-explorer-config' ),
		atme_asset_version( "assets/js/shell{$suffix}.js" ),
		true
	);
}

/**
 * The cache-busting version for one asset.
 *
 * Under `WP_DEBUG` or `SCRIPT_DEBUG` the file's modification time, so a
 * rebuild changes the URL; in production the plugin version, which changes
 * exactly when the shipped bytes do and costs no `stat()` per request.
 *
 * @since 0.1.0
 *
 * @param string $relative_path Path under the plugin directory.
 * @return string Version string.
 */
function atme_asset_version( $relative_path ) {
	$developing = ( defined( 'WP_DEBUG' ) && WP_DEBUG ) || ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG );

	if ( ! $developing ) {
		return ATME_VERSION;
	}

	$file = ATME_DIR . ltrim( $relative_path, '/' );

	if ( ! file_exists( $file ) ) {
		return ATME_VERSION;
	}

	return (string) filemtime( $file );
}

/**
 * `.min` unless the site asked for readable sources.
 *
 * @since 0.1.0
 *
 * @return string Either `.min` or an empty string.
 */
function atme_asset_suffix() {
	return ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
}

/**
 * The configuration both bundles need.
 *
 * REST roots and a nonce, plus everything the grid would otherwise have to
 * make a request to learn before first paint. Reaches the page as
 * `window.allTerrainMediaExplorer` in every host, so a bundle never has to
 * know which one it woke up in.
 *
 * @since 0.1.0
 *
 * @return array Configuration blob.
 */
function atme_script_config() {
	$config = array(
		'restUrl'      => esc_url_raw( rest_url( ATME_REST_NAMESPACE ) ),
		'wpRestUrl'    => esc_url_raw( rest_url( 'wp/v2' ) ),
		'nonce'        => wp_create_nonce( 'wp_rest' ),
		'adminUrl'     => esc_url_raw( admin_url() ),
		'uploadUrl'    => esc_url_raw( admin_url( 'upload.php' ) ),
		// The taxonomy's `rest_base`, not its slug — the two differ and the
		// bundle must not guess.
		'folderField'  => 'atme-folders',
		'canUpload'    => atme_can_upload(),
		'viewerId'     => get_current_user_id(),
		// What the server can convert, probed once — the UI greys what the
		// host cannot do rather than promising it.
		'conversion'   => atme_conversion_capabilities(),
		'maxUploadMb'  => (int) floor( wp_max_upload_size() / MB_IN_BYTES ),
		'version'      => ATME_VERSION,
	);

	/**
	 * Filters the configuration handed to the explorer and shell bundles.
	 *
	 * @since 0.1.0
	 *
	 * @param array $config Configuration blob.
	 */
	return apply_filters( 'atme_script_config', $config );
}

/**
 * Prints the configuration as a global on its carrier handle.
 *
 * @since 0.1.0
 *
 * @param string $handle Script handle to attach it to.
 * @return void
 */
function atme_print_config( $handle ) {
	wp_add_inline_script(
		$handle,
		'window.allTerrainMediaExplorer = ' . wp_json_encode( atme_script_config() ) . ';',
		'before'
	);
}
