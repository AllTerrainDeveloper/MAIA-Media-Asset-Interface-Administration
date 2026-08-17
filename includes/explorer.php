<?php
/**
 * WP Explorer integration, server half.
 *
 * WP Explorer already has a Media section; this plugin does not replace it,
 * it decorates it: a "Reveal in Media Explorer" action on every media
 * preview, registered here because preview actions are server-declared —
 * capability-gated and enumerated in PHP — while their behaviour is wired
 * client-side in the shell bundle.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

add_action( 'plugins_loaded', 'atme_maybe_init_explorer', 20 );

/**
 * Wires the WP Explorer hooks, when there is an explorer to decorate.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_maybe_init_explorer() {
	if ( ! atme_shell_has( 'register_window' ) ) {
		return;
	}

	foreach ( atme_shell_hooks( 'my_wordpress_preview_actions' ) as $hook ) {
		add_filter( $hook, 'atme_explorer_preview_actions' );
	}
}

/**
 * Adds the reveal action to WP Explorer's media previews.
 *
 * @since 0.1.0
 *
 * @param array $actions Declared preview actions.
 * @return array With ours appended.
 */
function atme_explorer_preview_actions( $actions ) {
	$actions[] = array(
		'id'         => 'atme-reveal',
		'label'      => __( 'Reveal in MAIA', 'allterrain-media-explorer' ),
		'icon'       => 'dashicons-format-gallery',
		'capability' => 'upload_files',
		'sections'   => array( 'media' ),
		'script'     => 'allterrain-media-explorer-shell',
	);

	return $actions;
}
