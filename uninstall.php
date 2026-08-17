<?php
/**
 * Uninstall: remove every trace, keep every pixel that matters.
 *
 * Deleting the plugin removes its bookkeeping — folder terms, collections,
 * provenance meta, the wizard option and the stashed version files. It does
 * not touch a single attachment: the media library was never ours, only the
 * organization of it.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;

// The stashed version files, then the directory — through WP_Filesystem,
// which is the API uninstall code is expected to speak.
$atme_upload_dir   = wp_upload_dir();
$atme_versions_dir = trailingslashit( $atme_upload_dir['basedir'] ) . 'atme-versions/';

if ( is_dir( $atme_versions_dir ) ) {
	global $wp_filesystem;

	require_once ABSPATH . 'wp-admin/includes/file.php';

	if ( WP_Filesystem() && $wp_filesystem ) {
		$wp_filesystem->delete( $atme_versions_dir, true );
	}
}

// Collections are ours; attachments are not.
$atme_collections = get_posts(
	array(
		'post_type'      => 'atme-collection',
		'post_status'    => 'any',
		'posts_per_page' => -1,
		'fields'         => 'ids',
	)
);

foreach ( $atme_collections as $atme_collection_id ) {
	wp_delete_post( $atme_collection_id, true );
}

// Folder terms. The taxonomy is unregistered at uninstall time, so straight SQL.
// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
$atme_term_ids = $wpdb->get_col(
	$wpdb->prepare( "SELECT term_id FROM {$wpdb->term_taxonomy} WHERE taxonomy = %s", 'atme_folder' )
);

if ( $atme_term_ids ) {
	$atme_ids_in = implode( ',', array_map( 'intval', $atme_term_ids ) );

	$wpdb->query( "DELETE FROM {$wpdb->term_relationships} WHERE term_taxonomy_id IN ( SELECT term_taxonomy_id FROM {$wpdb->term_taxonomy} WHERE term_id IN ( {$atme_ids_in} ) )" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query( "DELETE FROM {$wpdb->term_taxonomy} WHERE term_id IN ( {$atme_ids_in} )" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query( "DELETE FROM {$wpdb->terms} WHERE term_id IN ( {$atme_ids_in} )" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}

// Our meta rows, wherever they landed.
$wpdb->query( "DELETE FROM {$wpdb->postmeta} WHERE meta_key IN ( '_atme_versions', '_atme_converted_from', '_atme_conversions', '_atme_hash', '_atme_query' )" );
// phpcs:enable

delete_option( 'atme_wizard_state' );
