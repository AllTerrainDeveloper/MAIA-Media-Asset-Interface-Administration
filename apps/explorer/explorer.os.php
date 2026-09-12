<?php
/**
 * MAIA App Framework window.
 *
 * @package AllTerrain_Media_Explorer
 */

use OpenStation\App;

defined( 'ABSPATH' ) || exit;

return App::define( 'allterrain-media-explorer' )
	->title( __( 'MAIA', 'allterrain-media-explorer' ) )
	->icon( 'dashicons-format-gallery' )
	->size( 1280, 800 )
	->min_size( 720, 480 )
	->placement( 'dock' )
	->capabilities( 'upload_files' )
	->state( array( 'mediaId' => 0, 'wizard' => false, 'revision' => 0 ) )
	->mount( 'atme_app_retarget' )
	->action( 'reopen', 'atme_app_retarget' )
	->config( 'atme_script_config' )
	->client( ATME_DIR . 'assets/js/explorer' . atme_asset_suffix() . '.js' );
