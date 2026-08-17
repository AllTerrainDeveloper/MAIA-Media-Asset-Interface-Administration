<?php
/**
 * Shared helpers the REST routes, the abilities and the UI all call.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

/**
 * Tells the shell an attachment changed, so every open surface repaints.
 *
 * The shell's content-change channel is how two explorer windows, WP
 * Explorer's media section and the wallpaper's file tiles stay in sync
 * without anyone polling. Quietly a no-op without the shell.
 *
 * @since 0.1.0
 *
 * @param int    $attachment_id The attachment.
 * @param string $action        One of `created`, `updated`, `trashed`.
 * @return void
 */
function atme_record_change( $attachment_id, $action ) {
	if ( ! function_exists( 'openstation_content_changes_record' ) ) {
		return;
	}

	openstation_content_changes_record( 'attachment', (int) $attachment_id, (string) $action );
}

/**
 * The sha1 of an attachment's file, computed lazily and cached in meta.
 *
 * The digest is how duplicates are found by index lookup instead of by
 * comparing every file against every other. Hashing happens the first time
 * anyone asks about a file, not on upload — a library that never opens the
 * duplicates view never pays for it.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return string The hash, or an empty string when the file is gone.
 */
function atme_file_hash( $attachment_id ) {
	$known = (string) get_post_meta( $attachment_id, ATME_META_HASH, true );

	if ( '' !== $known ) {
		return $known;
	}

	$path = atme_original_file_path( $attachment_id );

	if ( ! $path ) {
		return '';
	}

	$hash = (string) sha1_file( $path );

	if ( '' !== $hash ) {
		update_post_meta( $attachment_id, ATME_META_HASH, $hash );
	}

	return $hash;
}

/**
 * Everything the inspector wants to say about one attachment's file.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return array File facts: exists, size in bytes, dimensions, MIME.
 */
function atme_file_facts( $attachment_id ) {
	$path  = atme_original_file_path( $attachment_id );
	$facts = array(
		'exists' => (bool) $path,
		'bytes'  => 0,
		'width'  => 0,
		'height' => 0,
		'mime'   => (string) get_post_mime_type( $attachment_id ),
	);

	if ( ! $path ) {
		return $facts;
	}

	$facts['bytes'] = (int) filesize( $path );

	$size = wp_getimagesize( $path );

	if ( $size ) {
		$facts['width']  = (int) $size[0];
		$facts['height'] = (int) $size[1];
	}

	return $facts;
}

/**
 * Regenerates every sub-size for an attachment from its current file.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return true|WP_Error True on success.
 */
function atme_regenerate_thumbnails( $attachment_id ) {
	$path = atme_original_file_path( $attachment_id );

	if ( ! $path ) {
		return new WP_Error( 'atme_file_missing', __( 'The media item exists but its file is gone from disk.', 'allterrain-media-explorer' ) );
	}

	require_once ABSPATH . 'wp-admin/includes/image.php';

	$metadata = wp_generate_attachment_metadata( $attachment_id, $path );

	if ( empty( $metadata ) ) {
		return new WP_Error( 'atme_regenerate_failed', __( 'WordPress could not rebuild the image sizes.', 'allterrain-media-explorer' ) );
	}

	wp_update_attachment_metadata( $attachment_id, $metadata );
	atme_record_change( $attachment_id, 'updated' );

	return true;
}
