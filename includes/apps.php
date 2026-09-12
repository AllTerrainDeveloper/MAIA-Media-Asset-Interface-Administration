<?php
/**
 * App Framework registration; media operations keep their shared REST API.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

add_filter( 'openstation_apps_directories', 'atme_app_directories' );
add_filter( 'openstation_app_window_args', 'atme_app_window_args', 10, 2 );

/**
 * Whether the installed shell can host client-view apps.
 *
 * @return bool Framework available.
 */
function atme_has_app_framework() {
	return atme_shell_has( 'register_window' ) && function_exists( 'openstation_apps_registry' ) && class_exists( 'OpenStation\App' );
}

/**
 * Adds this plugin's definitions to the framework scan.
 *
 * @param string[] $directories Existing app directories.
 * @return string[] App directories.
 */
function atme_app_directories( $directories ) {
	if ( atme_has_app_framework() ) {
		$directories[] = ATME_DIR . 'apps';
	}
	return $directories;
}

/**
 * Keeps the config dependency and existing window filters on framework windows.
 *
 * The wallpaper icon stays on its existing registration path so all arguments
 * accepted by the stable atme_icon_args filter continue to work.
 *
 * @param array  $args Window registration.
 * @param string $id   App id.
 * @return array Window registration.
 */
function atme_app_window_args( $args, $id ) {
	if ( ! in_array( $id, array( 'allterrain-media-explorer', 'atme-viewer' ), true ) ) {
		return $args;
	}
	$args['scripts'] = array_merge( array( 'allterrain-media-explorer-config' ), $args['scripts'] );
	$args['style'] = 'allterrain-media-explorer';
	$args['capabilities'] = array( 'upload_files' );
	return apply_filters( 'atme-viewer' === $id ? 'atme_viewer_window_args' : 'atme_window_args', $args );
}

/**
 * Accepts an open or reopen target. Params are untrusted even on an app window.
 *
 * @param OpenStation\App\State $state App state.
 * @param OpenStation\App\Os    $os    Acting user's host.
 * @return void
 */
function atme_app_retarget( $state, $os ) {
	$id = $os->param( 'mediaId', 0 );
	$id = is_scalar( $id ) ? absint( $id ) : 0;
	$state->set( 'mediaId', $id && atme_can_edit_media( array( 'id' => $id ) ) ? $id : 0 );
	$state->set( 'wizard', true === $os->param( 'wizard', false ) );
	$state->set( 'revision', $state->get( 'revision' ) + 1 );
}
