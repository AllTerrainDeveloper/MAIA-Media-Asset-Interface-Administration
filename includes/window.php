<?php
/**
 * OpenStation integration: the window and everything hanging off it.
 *
 * The explorer is a **native** window rather than an iframe, and that is the
 * whole product. Rendering into the shell's own DOM is what gives the grid
 * `wp.os.dragManager` — one pointer-event pipeline shared with the wallpaper's
 * file tiles and every other window — so a photo can lift out of the grid and
 * land in a Gutenberg post, on a kanban card, or in a folder. None of that is
 * reachable from inside an iframe.
 *
 * Everything here sits behind a `function_exists()` gate resolved through
 * `shell-api.php`, because "declared in the header" and "present right now"
 * are different questions. A missing shell costs the desktop surfaces and an
 * admin notice, never a fatal.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

add_action( 'plugins_loaded', 'atme_maybe_init_openstation', 20 );
add_action( 'admin_notices', 'atme_missing_shell_notice' );

/**
 * Says so, on a site running without the shell.
 *
 * `Requires Plugins: desktop-mode` is enforced from WordPress 6.5; this
 * notice covers the versions below that, and the case the header cannot —
 * a dependency deleted from disk after activation. It does not deactivate
 * anything: folders and collections stay registered, so nothing looks lost.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_missing_shell_notice() {
	if ( atme_shell_has( 'register_window' ) || ! current_user_can( 'activate_plugins' ) ) {
		return;
	}

	$screen = get_current_screen();

	if ( ! $screen || ! in_array( $screen->id, array( 'plugins', 'plugins-network', 'dashboard' ), true ) ) {
		return;
	}

	printf(
		'<div class="notice notice-warning"><p><strong>%1$s</strong> %2$s</p></div>',
		esc_html__( 'MAIA needs OpenStation.', 'allterrain-media-explorer' ),
		esc_html__(
			'MAIA is a desktop app: it opens as a window on the OpenStation desktop, and dragging media anywhere runs on the shell’s pointer pipeline. Without OpenStation active, your folders and collections are safe but there is nowhere to open them.',
			'allterrain-media-explorer'
		)
	);
}

/**
 * Wires up the shell integrations, if there is a shell to wire into.
 *
 * On `plugins_loaded` rather than at file scope: plugins load alphabetically,
 * so this plugin runs before `desktop-mode` and none of the shell's functions
 * exist yet when this file is first read.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_maybe_init_openstation() {
	if ( ! atme_shell_has( 'register_window' ) ) {
		return;
	}

	add_action( 'init', 'atme_register_shell_surfaces', 20 );

	// Registered against both spellings of the hook; which fires depends on
	// the shell's version, and a listener that never fires costs nothing.
	foreach ( atme_shell_hooks( 'mode_init' ) as $hook ) {
		add_action( $hook, 'atme_enqueue_in_shell' );
	}

	add_action( 'admin_enqueue_scripts', 'atme_enqueue_shell_styles', 20 );
}

/**
 * Registers the window, the wallpaper icon, the file opener and the commands.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_register_shell_surfaces() {
	$registered = atme_shell_call(
		'register_window',
		'allterrain-media-explorer',
		/**
		 * Filters the native window registration.
		 *
		 * @since 0.1.0
		 *
		 * @param array $args Window arguments as the shell expects them.
		 */
		apply_filters(
			'atme_window_args',
			array(
				'title'        => __( 'MAIA', 'allterrain-media-explorer' ),
				'icon'         => 'dashicons-format-gallery',
				'template'     => 'atme_render_window_template',
				'script'       => 'allterrain-media-explorer',
				'style'        => 'allterrain-media-explorer',
				'width'        => 1280,
				'height'       => 800,
				'min_width'    => 720,
				'min_height'   => 480,
				'placement'    => 'dock',
				'capabilities' => array( 'upload_files' ),
			)
		)
	);

	if ( is_wp_error( $registered ) ) {
		return;
	}

	atme_shell_call(
		'register_window',
		'atme-viewer',
		/**
		 * Filters the Media Viewer window registration.
		 *
		 * @since 0.1.0
		 *
		 * @param array $args Window arguments as the shell expects them.
		 */
		apply_filters(
			'atme_viewer_window_args',
			array(
				'title'        => __( 'MAIA Viewer', 'allterrain-media-explorer' ),
				'icon'         => 'dashicons-visibility',
				'template'     => 'atme_render_viewer_template',
				'script'       => 'allterrain-media-explorer',
				'style'        => 'allterrain-media-explorer',
				'width'        => 1060,
				'height'       => 720,
				'min_width'    => 560,
				'min_height'   => 420,
				// No dock tile of its own: the viewer is a document window
				// you reach through a photo, not an app you launch cold.
				'placement'    => 'none',
				'capabilities' => array( 'upload_files' ),
			)
		)
	);

	if ( atme_shell_has( 'register_icon' ) ) {
		atme_shell_call(
			'register_icon',
			'allterrain-media-explorer',
			/**
			 * Filters the wallpaper icon registration.
			 *
			 * @since 0.1.0
			 *
			 * @param array $args Icon arguments as the shell expects them.
			 */
			apply_filters(
				'atme_icon_args',
				array(
					'title'        => __( 'MAIA', 'allterrain-media-explorer' ),
					'icon'         => 'dashicons-format-gallery',
					'window'       => 'allterrain-media-explorer',
					'position'     => 25,
					'capabilities' => array( 'upload_files' ),
				)
			)
		);
	}

	if ( atme_shell_has( 'register_file_opener' ) ) {
		// The shell's file-association registry: this row appears in
		// OpenStation Preferences → File Associations. Not default-flagged —
		// the "(default)" suffix there marks the opener WordPress ships, and
		// that stays with the stock media editor. MAIA becomes the effective
		// opener by seeding the user association client-side when none is
		// stored, which the dropdown shows as the selected row. One opener,
		// one verb: double-clicking a media file shows the photo, not a
		// form. The photo editor's *edit* opener composes alongside.
		atme_shell_call(
			'register_file_opener',
			'atme-viewer',
			array(
				'label'        => __( 'MAIA Viewer', 'allterrain-media-explorer' ),
				'types'        => array( 'attachment' ),
				'is_default'   => false,
				'sort'         => 5,
				'script'       => 'allterrain-media-explorer-shell',
				'capabilities' => array( 'upload_files' ),
			)
		);
	}

	if ( atme_shell_has( 'register_command' ) ) {
		$commands = array(
			array(
				'slug'        => 'allterrain-media-explorer',
				'label'       => __( 'Media: open the explorer', 'allterrain-media-explorer' ),
				'description' => __( 'Browse, organize and convert everything in the media library.', 'allterrain-media-explorer' ),
				'icon'        => 'dashicons-format-gallery',
				'script'      => 'allterrain-media-explorer-shell',
			),
			array(
				'slug'        => 'allterrain-media-explorer-wizard',
				'label'       => __( 'Media: start the optimization wizard', 'allterrain-media-explorer' ),
				'description' => __( 'Scan the library for oversized images, legacy formats, missing alt text and duplicates.', 'allterrain-media-explorer' ),
				'icon'        => 'dashicons-superhero',
				'script'      => 'allterrain-media-explorer-shell',
			),
		);

		foreach ( $commands as $command ) {
			atme_shell_call( 'register_command', $command );
		}
	}
}

/**
 * Emits the window's body markup.
 *
 * The shell clones this into the window before calling the JavaScript render
 * callback, so the window paints a frame and a loading state immediately
 * instead of flashing empty while the bundle boots.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_render_window_template() {
	?>
	<div class="atme" data-atme-root data-host="window">
		<div class="atme__loading" data-atme-loading>
			<os-spinner preset="inline"></os-spinner>
			<span><?php esc_html_e( 'Opening your library…', 'allterrain-media-explorer' ); ?></span>
		</div>
		<div class="atme__frame" data-atme-frame hidden>
			<aside class="atme__sidebar" data-atme-sidebar></aside>
			<main class="atme__main" data-atme-main></main>
			<aside class="atme__inspector" data-atme-inspector hidden></aside>
		</div>
	</div>
	<?php
}

/**
 * Emits the Media Viewer window's body markup.
 *
 * A dark stage and nothing else until the bundle boots — a viewer's empty
 * state is darkness, not chrome.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_render_viewer_template() {
	?>
	<div class="atme-viewer" data-atme-viewer-root></div>
	<?php
}

/**
 * Loads the eager shell bundle and styles while the desktop is rendering.
 *
 * `openstation_mode_init` fires while the shell paints, which is the
 * documented place for a plugin to enqueue shell-level code. The shell bundle
 * must be there *before* WP Explorer asks its decoration filters — a hook
 * registered after the question was asked decorates nothing.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_enqueue_in_shell() {
	if ( ! atme_can_upload() ) {
		return;
	}

	wp_enqueue_script( 'allterrain-media-explorer-shell' );
	wp_enqueue_style( 'allterrain-media-explorer' );
}

/**
 * Puts the stylesheet on shell pages before anything renders.
 *
 * The window's own `style` handle covers the window; this covers everything
 * that mounts outside it — ghost chips mid-drag, Quick Look, toasts.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_enqueue_shell_styles() {
	if ( ! atme_shell_is_active() || atme_shell_is_chromeless() ) {
		return;
	}

	if ( ! atme_can_upload() ) {
		return;
	}

	wp_enqueue_style( 'allterrain-media-explorer' );
	wp_enqueue_script( 'allterrain-media-explorer-shell' );
}
