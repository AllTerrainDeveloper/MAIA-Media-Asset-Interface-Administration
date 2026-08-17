<?php
/**
 * Where is this file used?
 *
 * The question core's Media Library cannot answer, asked before every delete.
 * Three passes: featured-image meta, content references (by URL and by the
 * `wp-image-{id}` class Gutenberg and classic both stamp), and site options
 * (custom logo, site icon). Page builders and gallery plugins append their
 * own rows through the `atme_media_usage` filter.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

/**
 * Every place one attachment is used.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return array[] Rows of {postId, title, type, typeLabel, usedAs, editUrl},
 *                 plus site-level rows with postId 0.
 */
function atme_media_usage( $attachment_id ) {
	$attachment_id = (int) $attachment_id;
	$rows          = array();
	$seen          = array();

	// Pass 1 — featured image of. An explicit type list rather than 'any':
	// 'any' silently skips types flagged exclude_from_search, and a kanban
	// task using a photo is exactly the kind of usage worth reporting.
	$types = array_diff( get_post_types(), array( 'revision', 'attachment', 'nav_menu_item' ) );

	$featured = get_posts(
		array(
			'post_type'      => array_values( $types ),
			'post_status'    => 'any',
			'posts_per_page' => 50,
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
				array(
					'key'   => '_thumbnail_id',
					'value' => $attachment_id,
				),
			),
		)
	);

	foreach ( $featured as $post_id ) {
		$rows[]            = atme_usage_row( $post_id, 'featured' );
		$seen[ $post_id ]  = true;
	}

	// Pass 2 — referenced in content. Two spellings: the file URL (any
	// sub-size shares the original's stem) and the id-stamped class.
	global $wpdb;

	$url  = (string) wp_get_attachment_url( $attachment_id );
	$stem = $url ? preg_replace( '/\.[a-z0-9]+$/i', '', wp_basename( $url ) ) : '';

	$likes  = array( '%wp-image-' . $attachment_id . '%' );
	$likes[] = '%wp:image {"id":' . $attachment_id . ',%';

	if ( $stem ) {
		$likes[] = '%' . $wpdb->esc_like( $stem ) . '%';
	}

	$where = implode( ' OR ', array_fill( 0, count( $likes ), 'post_content LIKE %s' ) );

	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$content_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT ID FROM {$wpdb->posts} WHERE post_type NOT IN ( 'revision', 'attachment' ) AND post_status NOT IN ( 'trash', 'auto-draft' ) AND ( {$where} ) LIMIT 100", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$likes
		)
	);

	foreach ( array_map( 'intval', $content_ids ) as $post_id ) {
		if ( isset( $seen[ $post_id ] ) ) {
			continue;
		}

		$rows[]           = atme_usage_row( $post_id, 'content' );
		$seen[ $post_id ] = true;
	}

	// Pass 3 — the site itself.
	if ( (int) get_option( 'site_icon' ) === $attachment_id ) {
		$rows[] = array(
			'postId'    => 0,
			'title'     => __( 'Site Icon', 'allterrain-media-explorer' ),
			'type'      => 'option',
			'typeLabel' => __( 'Site setting', 'allterrain-media-explorer' ),
			'usedAs'    => 'option',
			'editUrl'   => esc_url_raw( admin_url( 'options-general.php' ) ),
		);
	}

	if ( (int) get_theme_mod( 'custom_logo' ) === $attachment_id ) {
		$rows[] = array(
			'postId'    => 0,
			'title'     => __( 'Site Logo', 'allterrain-media-explorer' ),
			'type'      => 'option',
			'typeLabel' => __( 'Site setting', 'allterrain-media-explorer' ),
			'usedAs'    => 'option',
			'editUrl'   => esc_url_raw( admin_url( 'customize.php' ) ),
		);
	}

	/**
	 * Filters the usage rows for an attachment.
	 *
	 * The seam for page builders, gallery plugins and custom fields to add
	 * the places only they know about.
	 *
	 * @since 0.1.0
	 *
	 * @param array[] $rows          Usage rows.
	 * @param int     $attachment_id The attachment.
	 */
	return apply_filters( 'atme_media_usage', $rows, $attachment_id );
}

/**
 * One usage row.
 *
 * @since 0.1.0
 *
 * @param int    $post_id Post using the attachment.
 * @param string $used_as `featured` or `content`.
 * @return array The row.
 */
function atme_usage_row( $post_id, $used_as ) {
	$type   = get_post_type( $post_id );
	$object = $type ? get_post_type_object( $type ) : null;

	return array(
		'postId'    => (int) $post_id,
		'title'     => get_the_title( $post_id ),
		'type'      => (string) $type,
		'typeLabel' => $object ? (string) $object->labels->singular_name : (string) $type,
		'usedAs'    => $used_as,
		'editUrl'   => esc_url_raw( (string) get_edit_post_link( $post_id, 'raw' ) ),
	);
}

/**
 * Whether an attachment is used anywhere at all.
 *
 * Cheaper than the full scan only in intent — it runs the same passes but
 * stops at the first row. Used by the Unused smart view and the delete guard.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return bool True when at least one usage exists.
 */
function atme_is_used( $attachment_id ) {
	return count( atme_media_usage( $attachment_id ) ) > 0;
}
