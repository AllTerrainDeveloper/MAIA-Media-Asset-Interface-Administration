<?php
/**
 * Folders and collections.
 *
 * A folder is a term; filing is `wp_set_object_terms()`. These helpers exist
 * so the REST routes and the abilities share one spelling of the rules — a
 * name is trimmed, a parent must exist, unfiling means removing terms rather
 * than deleting anything.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

/**
 * The folder tree, shaped for the sidebar.
 *
 * @since 0.1.0
 *
 * @return array[] Flat rows of {id, name, parent, count}; the client nests them.
 */
function atme_folder_tree() {
	$terms = get_terms(
		array(
			'taxonomy'   => ATME_FOLDER_TAX,
			'hide_empty' => false,
		)
	);

	if ( is_wp_error( $terms ) ) {
		return array();
	}

	$rows = array();

	foreach ( $terms as $term ) {
		$rows[] = array(
			'id'     => (int) $term->term_id,
			'name'   => $term->name,
			'parent' => (int) $term->parent,
			'count'  => (int) $term->count,
		);
	}

	return $rows;
}

/**
 * Creates a folder.
 *
 * @since 0.1.0
 *
 * @param string $name   Folder name.
 * @param int    $parent Parent term id, 0 for top level.
 * @return int|WP_Error The new term id.
 */
function atme_create_folder( $name, $parent = 0 ) {
	$name = trim( sanitize_text_field( $name ) );

	if ( '' === $name ) {
		return new WP_Error( 'atme_empty_name', __( 'A folder needs a name.', 'allterrain-media-explorer' ) );
	}

	if ( $parent && ! term_exists( (int) $parent, ATME_FOLDER_TAX ) ) {
		return new WP_Error( 'atme_no_such_folder', __( 'The parent folder is gone.', 'allterrain-media-explorer' ) );
	}

	$created = wp_insert_term( $name, ATME_FOLDER_TAX, array( 'parent' => (int) $parent ) );

	if ( is_wp_error( $created ) ) {
		return $created;
	}

	return (int) $created['term_id'];
}

/**
 * Files attachments into a folder, additively.
 *
 * Additive because a folder is a label: filing a photo under Trips does not
 * unfile it from Portraits. Moving is the client saying "remove there, add
 * here" explicitly.
 *
 * @since 0.1.0
 *
 * @param int[] $attachment_ids Attachments.
 * @param int   $folder_id      Folder term id.
 * @return true|WP_Error True when all were filed.
 */
function atme_file_into_folder( $attachment_ids, $folder_id ) {
	if ( ! term_exists( (int) $folder_id, ATME_FOLDER_TAX ) ) {
		return new WP_Error( 'atme_no_such_folder', __( 'That folder is gone.', 'allterrain-media-explorer' ) );
	}

	foreach ( array_map( 'intval', (array) $attachment_ids ) as $attachment_id ) {
		if ( 'attachment' !== get_post_type( $attachment_id ) ) {
			continue;
		}

		$result = wp_set_object_terms( $attachment_id, array( (int) $folder_id ), ATME_FOLDER_TAX, true );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		atme_record_change( $attachment_id, 'updated' );
	}

	return true;
}

/**
 * Takes attachments out of a folder.
 *
 * @since 0.1.0
 *
 * @param int[] $attachment_ids Attachments.
 * @param int   $folder_id      Folder term id.
 * @return true|WP_Error True when all were unfiled.
 */
function atme_unfile_from_folder( $attachment_ids, $folder_id ) {
	foreach ( array_map( 'intval', (array) $attachment_ids ) as $attachment_id ) {
		$result = wp_remove_object_terms( $attachment_id, (int) $folder_id, ATME_FOLDER_TAX );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		atme_record_change( $attachment_id, 'updated' );
	}

	return true;
}

add_filter( 'rest_attachment_query', 'atme_rest_attachment_query', 10, 2 );
add_filter( 'rest_attachment_collection_params', 'atme_rest_attachment_collection_params' );

/**
 * Documents the `atme_view` param on `/wp/v2/media`.
 *
 * @since 0.1.0
 *
 * @param array $params Collection params.
 * @return array With ours.
 */
function atme_rest_attachment_collection_params( $params ) {
	$params['atme_view'] = array(
		'description' => __( 'A Media Explorer smart view to filter by.', 'allterrain-media-explorer' ),
		'type'        => 'string',
		'enum'        => array( '', 'missing-alt', 'converted', 'unfiled' ),
		'default'     => '',
	);

	return $params;
}

/**
 * Teaches core's media collection the smart views.
 *
 * Riding `/wp/v2/media` rather than duplicating a browse endpoint: the grid
 * keeps one code path for every view, and core keeps doing the paging,
 * ordering and field selection it already does well.
 *
 * @since 0.1.0
 *
 * @param array           $args    WP_Query args.
 * @param WP_REST_Request $request The request.
 * @return array Possibly narrowed args.
 */
function atme_rest_attachment_query( $args, $request ) {
	$view = (string) $request->get_param( 'atme_view' );

	if ( 'missing-alt' === $view ) {
		$args['post_mime_type'] = 'image';
		// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
		$args['meta_query'] = array(
			'relation' => 'OR',
			array(
				'key'     => '_wp_attachment_image_alt',
				'compare' => 'NOT EXISTS',
			),
			array(
				'key'   => '_wp_attachment_image_alt',
				'value' => '',
			),
		);
	}

	if ( 'converted' === $view ) {
		// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
		$args['meta_query'] = array(
			array(
				'key'     => ATME_META_CONVERTED_FROM,
				'compare' => 'EXISTS',
			),
		);
	}

	if ( 'unfiled' === $view ) {
		$folder_ids = get_terms(
			array(
				'taxonomy'   => ATME_FOLDER_TAX,
				'hide_empty' => false,
				'fields'     => 'ids',
			)
		);

		if ( ! is_wp_error( $folder_ids ) && ! empty( $folder_ids ) ) {
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
			$args['tax_query'] = array(
				array(
					'taxonomy' => ATME_FOLDER_TAX,
					'terms'    => array_map( 'intval', $folder_ids ),
					'operator' => 'NOT IN',
				),
			);
		}
	}

	/**
	 * Filters the query args a smart view produces.
	 *
	 * The seam for a plugin to add its own `atme_view` values — register the
	 * name via `atme_smart_views` too so the sidebar offers it.
	 *
	 * @since 0.1.0
	 *
	 * @param array  $args WP_Query args.
	 * @param string $view The requested view.
	 */
	return apply_filters( 'atme_view_query', $args, $view );
}

/**
 * Duplicate groups: files sharing a hash.
 *
 * Only hashed files can be grouped, and hashing happens lazily (in the
 * wizard scan and on first inspection) — so this reports what is known and
 * says how much of the library that covers rather than pretending.
 *
 * @since 0.1.0
 *
 * @return array {
 *     @type int     $hashed Total files with a known hash.
 *     @type array[] $groups Each: { hash, ids: int[] }.
 * }
 */
function atme_duplicate_groups() {
	global $wpdb;

	// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT pm.meta_value AS hash, GROUP_CONCAT( pm.post_id ORDER BY pm.post_id ) AS ids
			 FROM {$wpdb->postmeta} pm
			 INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id AND p.post_type = 'attachment'
			 WHERE pm.meta_key = %s AND pm.meta_value != ''
			 GROUP BY pm.meta_value
			 HAVING COUNT(*) > 1
			 LIMIT 200",
			ATME_META_HASH
		)
	);

	$hashed = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$wpdb->postmeta} pm
			 INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id AND p.post_type = 'attachment'
			 WHERE pm.meta_key = %s AND pm.meta_value != ''",
			ATME_META_HASH
		)
	);
	// phpcs:enable

	$groups = array();

	foreach ( (array) $rows as $row ) {
		$groups[] = array(
			'hash' => (string) $row->hash,
			'ids'  => array_map( 'intval', explode( ',', (string) $row->ids ) ),
		);
	}

	return array(
		'hashed' => $hashed,
		'groups' => $groups,
	);
}
