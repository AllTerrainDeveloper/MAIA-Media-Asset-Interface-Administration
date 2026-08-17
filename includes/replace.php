<?php
/**
 * Replace a file in place, and the version history that makes it safe.
 *
 * The one thing every "enable media replace" plugin sells: swap the file
 * behind an attachment while its ID, its URL and every post embedding it
 * stay put. The twist here is that nothing is lost — the outgoing original
 * is stashed under `uploads/atme-versions/` and listed in meta, so replace
 * is an undoable operation, not a small deletion.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

/**
 * How many versions one attachment keeps.
 *
 * @since 0.1.0
 *
 * @return int Cap; the oldest version past it is pruned, files and all.
 */
function atme_version_cap() {
	/**
	 * Filters how many stashed versions an attachment keeps.
	 *
	 * @since 0.1.0
	 *
	 * @param int $cap Default 5.
	 */
	return max( 1, (int) apply_filters( 'atme_version_cap', 5 ) );
}

/**
 * The directory versions live in, created on first use.
 *
 * @since 0.1.0
 *
 * @return string|WP_Error Absolute path with a trailing slash.
 */
function atme_versions_dir() {
	$upload_dir = wp_upload_dir();

	if ( ! empty( $upload_dir['error'] ) ) {
		return new WP_Error( 'atme_uploads_unwritable', $upload_dir['error'] );
	}

	$dir = trailingslashit( $upload_dir['basedir'] ) . 'atme-versions/';

	if ( ! wp_mkdir_p( $dir ) ) {
		return new WP_Error( 'atme_versions_unwritable', __( 'The versions directory could not be created.', 'allterrain-media-explorer' ) );
	}

	// Version files are working copies, not published media; no directory
	// listing for the curious.
	if ( ! file_exists( $dir . 'index.php' ) ) {
		file_put_contents( $dir . 'index.php', "<?php\n// Silence is golden.\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
	}

	return $dir;
}

/**
 * Replaces the file behind an attachment, keeping its ID and URL.
 *
 * Stashes the current original as a version, moves the new file into the
 * attachment's slot under the same name, regenerates every sub-size, and
 * announces the change. The new file must be the same media *kind* — an
 * image replaces an image — but not the same format: replacing a PNG with
 * the WebP just converted from it is the point.
 *
 * @since 0.1.0
 *
 * @param int    $attachment_id The attachment to replace.
 * @param string $new_file      Path to the incoming file, e.g. an upload's tmp_name
 *                              already moved into uploads, or a converted sibling's file.
 * @param array  $args {
 *     Optional arguments.
 *
 *     @type string $mime      MIME of the incoming file. Detected when omitted.
 *     @type bool   $keep_name Keep the current filename (and so the URL). Default true.
 * }
 * @return true|WP_Error True on success.
 */
function atme_replace( $attachment_id, $new_file, $args = array() ) {
	$args = wp_parse_args(
		$args,
		array(
			'mime'      => '',
			/**
			 * Filters whether replace keeps the existing filename by default.
			 *
			 * Keeping the name keeps the URL — the reason to replace at all.
			 *
			 * @since 0.1.0
			 *
			 * @param bool $keep_name Default true.
			 */
			'keep_name' => (bool) apply_filters( 'atme_replace_keep_name', true ),
		)
	);

	$post = get_post( $attachment_id );

	if ( ! $post || 'attachment' !== $post->post_type ) {
		return new WP_Error( 'atme_not_an_attachment', __( 'No such media item.', 'allterrain-media-explorer' ) );
	}

	if ( ! file_exists( $new_file ) ) {
		return new WP_Error( 'atme_file_missing', __( 'The incoming file is not there.', 'allterrain-media-explorer' ) );
	}

	$current = atme_original_file_path( $attachment_id );

	if ( ! $current ) {
		return new WP_Error( 'atme_file_missing', __( 'The media item exists but its file is gone from disk.', 'allterrain-media-explorer' ) );
	}

	$mime = $args['mime'];

	if ( ! $mime ) {
		$check = wp_check_filetype_and_ext( $new_file, basename( $new_file ) );
		$mime  = (string) $check['type'];
	}

	if ( ! $mime ) {
		return new WP_Error( 'atme_unknown_type', __( 'The incoming file is not a type WordPress allows.', 'allterrain-media-explorer' ) );
	}

	$was_image = wp_attachment_is_image( $attachment_id );
	$is_image  = 0 === strpos( $mime, 'image/' );

	if ( $was_image !== $is_image ) {
		return new WP_Error( 'atme_kind_mismatch', __( 'Replace swaps like for like — an image for an image, a document for a document.', 'allterrain-media-explorer' ) );
	}

	$stashed = atme_stash_version( $attachment_id );

	if ( is_wp_error( $stashed ) ) {
		return $stashed;
	}

	// The old sub-sizes belong to the old pixels. Delete them before the
	// metadata that names them is rebuilt, or they linger as orphans forever.
	atme_delete_sub_sizes( $attachment_id );

	if ( $args['keep_name'] && pathinfo( $current, PATHINFO_EXTENSION ) === pathinfo( $new_file, PATHINFO_EXTENSION ) ) {
		$target = $current;
	} else {
		// A new format needs a new extension; a caller that opted out of
		// keeping the name gets a fresh unique one next to the old.
		$dir      = dirname( $current );
		$basename = pathinfo( $args['keep_name'] ? $current : $new_file, PATHINFO_FILENAME )
			. '.' . pathinfo( $new_file, PATHINFO_EXTENSION );
		$target   = trailingslashit( $dir ) . wp_unique_filename( $dir, $basename );
	}

	$moved = @rename( $new_file, $target ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.rename_rename

	if ( ! $moved && ! copy( $new_file, $target ) ) {
		return new WP_Error( 'atme_move_failed', __( 'The incoming file could not be moved into place.', 'allterrain-media-explorer' ) );
	}

	if ( ! $moved ) {
		wp_delete_file( $new_file );
	}

	if ( $target !== $current ) {
		wp_delete_file( $current );

		// The scaled copy, if any, described the old original.
		$attached = (string) get_attached_file( $attachment_id );

		if ( $attached && $attached !== $current && file_exists( $attached ) ) {
			wp_delete_file( $attached );
		}
	}

	update_attached_file( $attachment_id, $target );
	wp_update_post(
		array(
			'ID'             => $attachment_id,
			'post_mime_type' => $mime,
		)
	);

	delete_post_meta( $attachment_id, ATME_META_HASH );

	require_once ABSPATH . 'wp-admin/includes/image.php';
	wp_update_attachment_metadata( $attachment_id, wp_generate_attachment_metadata( $attachment_id, $target ) );

	atme_record_change( $attachment_id, 'updated' );

	/**
	 * Fires after an attachment's file has been replaced in place.
	 *
	 * The moment for cache plugins and CDNs to purge the URL.
	 *
	 * @since 0.1.0
	 *
	 * @param int    $attachment_id The attachment.
	 * @param string $target        The file now behind it.
	 */
	do_action( 'atme_file_replaced', $attachment_id, $target );

	return true;
}

/**
 * The stored version rows for an attachment, and nothing else.
 *
 * Unset meta reads as an empty string, and a bare `(array)` cast turns that
 * into `array( '' )` — a phantom version that inflates every count. Only
 * arrays survive this filter.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return array[] Version rows, oldest first.
 */
function atme_versions_of( $attachment_id ) {
	$raw = get_post_meta( $attachment_id, ATME_META_VERSIONS, true );

	return array_values( array_filter( (array) $raw, 'is_array' ) );
}

/**
 * Stashes the attachment's current original as a version.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return true|WP_Error True when stashed.
 */
function atme_stash_version( $attachment_id ) {
	$dir = atme_versions_dir();

	if ( is_wp_error( $dir ) ) {
		return $dir;
	}

	$current = atme_original_file_path( $attachment_id );

	if ( ! $current ) {
		return new WP_Error( 'atme_file_missing', __( 'There is no file to stash.', 'allterrain-media-explorer' ) );
	}

	$stash_name = $attachment_id . '-' . time() . '-' . basename( $current );

	if ( ! copy( $current, $dir . $stash_name ) ) {
		return new WP_Error( 'atme_stash_failed', __( 'The current file could not be stashed as a version.', 'allterrain-media-explorer' ) );
	}

	$versions   = atme_versions_of( $attachment_id );
	$versions[] = array(
		'file'   => $stash_name,
		'bytes'  => (int) filesize( $current ),
		'mime'   => (string) get_post_mime_type( $attachment_id ),
		'date'   => time(),
		'author' => get_current_user_id(),
	);

	// Prune past the cap, files first so a failed meta write cannot orphan them.
	$cap = atme_version_cap();

	while ( count( $versions ) > $cap ) {
		$oldest = array_shift( $versions );

		if ( ! empty( $oldest['file'] ) && file_exists( $dir . $oldest['file'] ) ) {
			wp_delete_file( $dir . $oldest['file'] );
		}
	}

	update_post_meta( $attachment_id, ATME_META_VERSIONS, array_values( $versions ) );

	return true;
}

/**
 * Rolls an attachment back to a stashed version.
 *
 * The rollback itself goes through {@see atme_replace()}, so the file being
 * rolled *away from* is stashed too — undo has an undo.
 *
 * @since 0.1.0
 *
 * @param int    $attachment_id Attachment.
 * @param string $version_file  The version's stored filename, from the versions list.
 * @return true|WP_Error True on success.
 */
function atme_rollback( $attachment_id, $version_file ) {
	$dir = atme_versions_dir();

	if ( is_wp_error( $dir ) ) {
		return $dir;
	}

	$versions = atme_versions_of( $attachment_id );
	$entry    = null;

	foreach ( $versions as $version ) {
		if ( isset( $version['file'] ) && $version['file'] === $version_file ) {
			$entry = $version;
			break;
		}
	}

	// The name must come from the stored list, never from the request —
	// a caller-supplied path here would be a directory traversal.
	if ( ! $entry || ! file_exists( $dir . $entry['file'] ) ) {
		return new WP_Error( 'atme_no_such_version', __( 'That version is not in this item’s history.', 'allterrain-media-explorer' ) );
	}

	// Replace consumes its incoming file, and the stash must survive the
	// rollback, so hand it a copy.
	$upload_dir = wp_upload_dir();
	$staging    = trailingslashit( $upload_dir['path'] ) . wp_unique_filename( $upload_dir['path'], basename( $entry['file'] ) );

	if ( ! copy( $dir . $entry['file'], $staging ) ) {
		return new WP_Error( 'atme_stash_failed', __( 'The version could not be staged for rollback.', 'allterrain-media-explorer' ) );
	}

	return atme_replace( $attachment_id, $staging, array( 'mime' => $entry['mime'] ) );
}

/**
 * Deletes every sub-size file an attachment's metadata names.
 *
 * Not the original; that is the caller's affair.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return void
 */
function atme_delete_sub_sizes( $attachment_id ) {
	$metadata = wp_get_attachment_metadata( $attachment_id );

	if ( empty( $metadata['sizes'] ) || empty( $metadata['file'] ) ) {
		return;
	}

	$upload_dir = wp_upload_dir();
	$base_dir   = trailingslashit( $upload_dir['basedir'] ) . trailingslashit( dirname( $metadata['file'] ) );

	foreach ( $metadata['sizes'] as $size ) {
		if ( ! empty( $size['file'] ) && file_exists( $base_dir . $size['file'] ) ) {
			wp_delete_file( $base_dir . $size['file'] );
		}
	}
}

/**
 * The version history for one attachment, shaped for the inspector.
 *
 * Filenames stay server-side; the client refers to a version by its stored
 * name and gets facts, not paths.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return array[] Newest first: file, bytes, mime, date (ISO 8601), author name.
 */
function atme_version_history( $attachment_id ) {
	$versions = atme_versions_of( $attachment_id );
	$history  = array();

	foreach ( array_reverse( $versions ) as $version ) {
		$author = get_userdata( (int) ( $version['author'] ?? 0 ) );

		$history[] = array(
			'file'   => (string) ( $version['file'] ?? '' ),
			'bytes'  => (int) ( $version['bytes'] ?? 0 ),
			'mime'   => (string) ( $version['mime'] ?? '' ),
			'date'   => gmdate( 'c', (int) ( $version['date'] ?? 0 ) ),
			'author' => $author ? $author->display_name : '',
		);
	}

	return $history;
}
