<?php
/**
 * AllTerrain MAIA Viewer App Framework window.
 *
 * @package AllTerrain_Media_Explorer
 */

use OpenStation\App;

defined( 'ABSPATH' ) || exit;

return App::define( 'atme-viewer' )
	->title( __( 'AllTerrain MAIA Viewer', 'allterrain-maia' ) )
	->icon( 'dashicons-visibility' )
	->size( 1060, 720 )
	->min_size( 560, 420 )
	->placement( 'none' )
	->capabilities( 'upload_files' )
	->state( array( 'mediaId' => 0, 'wizard' => false, 'revision' => 0 ) )
	->mount( 'atme_app_retarget' )
	->action( 'reopen', 'atme_app_retarget' )
	->config( 'atme_script_config' )
	->client( ATME_DIR . 'assets/js/explorer' . atme_asset_suffix() . '.js' );
