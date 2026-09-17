<?php
/**
 * The Abilities API surface.
 *
 * Every verb the window offers a human is offered to machines with the same
 * capability checks: the shell's AI copilot, an MCP client, WP-CLI. Each
 * `execute_callback` is a one-liner over the same helper the UI calls, so
 * the two cannot drift.
 *
 * Every registration is guarded by `function_exists()` *lexically at the
 * call site* — WordPress.org's Plugin Check does not follow an early
 * return, and an unguarded call reads as "requires WordPress 6.9".
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

add_action( 'wp_abilities_api_categories_init', 'atme_register_ability_category' );
add_action( 'wp_abilities_api_init', 'atme_register_abilities' );

/**
 * Registers the category the abilities file under.
 *
 * On the *categories* hook, which fires before the abilities one; an ability
 * naming a missing category is refused outright.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_register_ability_category() {
	if ( function_exists( 'wp_register_ability_category' ) ) {
		wp_register_ability_category(
			'allterrain-media-explorer',
			array(
				'label'       => __( 'AllTerrain MAIA', 'allterrain-maia' ),
				'description' => __( 'Search, organize, convert and repair the media library.', 'allterrain-maia' ),
			)
		);
	}
}

/**
 * The schema for one attachment as the abilities present it.
 *
 * @since 0.1.0
 *
 * @return array JSON Schema.
 */
function atme_ability_media_schema() {
	return array(
		'type'       => 'object',
		'properties' => array(
			'id'    => array( 'type' => 'integer' ),
			'title' => array( 'type' => 'string' ),
			'url'   => array( 'type' => 'string' ),
			'mime'  => array( 'type' => 'string' ),
			'alt'   => array( 'type' => 'string' ),
			'bytes' => array( 'type' => 'integer' ),
		),
	);
}

/**
 * Registers every ability.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_register_abilities() {
	if ( function_exists( 'wp_register_ability' ) ) {
		wp_register_ability(
			'allterrain-media-explorer/search-media',
			array(
				'label'               => __( 'Search media', 'allterrain-maia' ),
				'description'         => __( 'Finds media items by text, type or folder.', 'allterrain-maia' ),
				'category'            => 'allterrain-media-explorer',
				'permission_callback' => 'atme_can_upload',
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'search' => array( 'type' => 'string' ),
						'mime'   => array( 'type' => 'string' ),
						'folder' => array( 'type' => 'integer' ),
						'limit'  => array(
							'type'    => 'integer',
							'default' => 20,
							'maximum' => 100,
						),
					),
				),
				'output_schema'       => array(
					'type'  => 'array',
					'items' => atme_ability_media_schema(),
				),
				'execute_callback'    => 'atme_ability_search_media',
				'meta'                => array( 'show_in_rest' => true ),
			)
		);
	}

	if ( function_exists( 'wp_register_ability' ) ) {
		wp_register_ability(
			'allterrain-media-explorer/get-media-usage',
			array(
				'label'               => __( 'Get media usage', 'allterrain-maia' ),
				'description'         => __( 'Lists every post and setting using a media item.', 'allterrain-maia' ),
				'category'            => 'allterrain-media-explorer',
				'permission_callback' => 'atme_can_edit_media',
				'input_schema'        => array(
					'type'       => 'object',
					'required'   => array( 'id' ),
					'properties' => array(
						'id' => array( 'type' => 'integer' ),
					),
				),
				'output_schema'       => array( 'type' => 'array' ),
				'execute_callback'    => 'atme_ability_get_usage',
				'meta'                => array( 'show_in_rest' => true ),
			)
		);
	}

	if ( function_exists( 'wp_register_ability' ) ) {
		wp_register_ability(
			'allterrain-media-explorer/set-alt-text',
			array(
				'label'               => __( 'Set alt text', 'allterrain-maia' ),
				'description'         => __( 'Writes an image’s alternative text.', 'allterrain-maia' ),
				'category'            => 'allterrain-media-explorer',
				'permission_callback' => 'atme_can_edit_media',
				'input_schema'        => array(
					'type'       => 'object',
					'required'   => array( 'id', 'alt' ),
					'properties' => array(
						'id'  => array( 'type' => 'integer' ),
						'alt' => array( 'type' => 'string' ),
					),
				),
				'output_schema'       => array( 'type' => 'boolean' ),
				'execute_callback'    => 'atme_ability_set_alt',
				'meta'                => array( 'show_in_rest' => true ),
			)
		);
	}

	if ( function_exists( 'wp_register_ability' ) ) {
		wp_register_ability(
			'allterrain-media-explorer/convert-media',
			array(
				'label'               => __( 'Convert media', 'allterrain-maia' ),
				'description'         => __( 'Converts an image to another format, as a copy or in place.', 'allterrain-maia' ),
				'category'            => 'allterrain-media-explorer',
				'permission_callback' => 'atme_can_edit_media',
				'input_schema'        => array(
					'type'       => 'object',
					'required'   => array( 'id', 'format' ),
					'properties' => array(
						'id'      => array( 'type' => 'integer' ),
						'format'  => array(
							'type' => 'string',
							'enum' => array_keys( atme_known_formats() ),
						),
						'quality' => array(
							'type'    => 'integer',
							'default' => 82,
						),
						'replace' => array(
							'type'    => 'boolean',
							'default' => false,
						),
					),
				),
				'output_schema'       => array( 'type' => 'integer' ),
				'execute_callback'    => 'atme_ability_convert',
				'meta'                => array( 'show_in_rest' => true ),
			)
		);
	}

	if ( function_exists( 'wp_register_ability' ) ) {
		wp_register_ability(
			'allterrain-media-explorer/list-folders',
			array(
				'label'               => __( 'List media folders', 'allterrain-maia' ),
				'description'         => __( 'The folder tree, with counts.', 'allterrain-maia' ),
				'category'            => 'allterrain-media-explorer',
				'permission_callback' => 'atme_can_upload',
				'input_schema'        => array( 'type' => 'object' ),
				'output_schema'       => array( 'type' => 'array' ),
				'execute_callback'    => 'atme_ability_list_folders',
				'meta'                => array( 'show_in_rest' => true ),
			)
		);
	}

	if ( function_exists( 'wp_register_ability' ) ) {
		wp_register_ability(
			'allterrain-media-explorer/file-media',
			array(
				'label'               => __( 'File media into a folder', 'allterrain-maia' ),
				'description'         => __( 'Adds media items to a folder, additively.', 'allterrain-maia' ),
				'category'            => 'allterrain-media-explorer',
				'permission_callback' => 'atme_can_edit_media_batch',
				'input_schema'        => array(
					'type'       => 'object',
					'required'   => array( 'ids', 'folder' ),
					'properties' => array(
						'ids'    => array(
							'type'  => 'array',
							'items' => array( 'type' => 'integer' ),
						),
						'folder' => array( 'type' => 'integer' ),
					),
				),
				'output_schema'       => array( 'type' => 'boolean' ),
				'execute_callback'    => 'atme_ability_file_media',
				'meta'                => array( 'show_in_rest' => true ),
			)
		);
	}

	if ( function_exists( 'wp_register_ability' ) ) {
		wp_register_ability(
			'allterrain-media-explorer/scan-library',
			array(
				'label'               => __( 'Scan the media library', 'allterrain-maia' ),
				'description'         => __( 'One chunk of the optimization scan: oversized images, legacy formats, missing alt text, duplicates.', 'allterrain-maia' ),
				'category'            => 'allterrain-media-explorer',
				'permission_callback' => 'atme_can_upload',
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'offset' => array(
							'type'    => 'integer',
							'default' => 0,
						),
						'limit'  => array(
							'type'    => 'integer',
							'default' => 25,
							'maximum' => 50,
						),
					),
				),
				'output_schema'       => array( 'type' => 'object' ),
				'execute_callback'    => 'atme_ability_scan',
				'meta'                => array( 'show_in_rest' => true ),
			)
		);
	}

	/**
	 * Fires after the abilities have been offered for registration.
	 *
	 * @since 0.1.0
	 */
	do_action( 'atme_abilities_registered' );
}

/**
 * Search, for machines.
 *
 * @since 0.1.0
 *
 * @param array $input Validated input.
 * @return array Media rows.
 */
function atme_ability_search_media( $input ) {
	$query_args = array(
		'post_type'      => 'attachment',
		'post_status'    => 'inherit',
		'posts_per_page' => min( 100, max( 1, (int) ( $input['limit'] ?? 20 ) ) ),
		'no_found_rows'  => true,
	);

	if ( ! empty( $input['search'] ) ) {
		$query_args['s'] = sanitize_text_field( $input['search'] );
	}

	if ( ! empty( $input['mime'] ) ) {
		$query_args['post_mime_type'] = sanitize_text_field( $input['mime'] );
	}

	if ( ! empty( $input['folder'] ) ) {
		$query_args['tax_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
			array(
				'taxonomy' => ATME_FOLDER_TAX,
				'terms'    => (int) $input['folder'],
			),
		);
	}

	$rows = array();

	foreach ( ( new WP_Query( $query_args ) )->posts as $post ) {
		if ( ! atme_can_edit_media( array( 'id' => $post->ID ) ) ) {
			continue;
		}
		$rows[] = array(
			'id'    => (int) $post->ID,
			'title' => get_the_title( $post ),
			'url'   => (string) wp_get_attachment_url( $post->ID ),
			'mime'  => (string) $post->post_mime_type,
			'alt'   => (string) get_post_meta( $post->ID, '_wp_attachment_image_alt', true ),
			'bytes' => atme_file_facts( $post->ID )['bytes'],
		);
	}

	return $rows;
}

/**
 * Usage, for machines.
 *
 * @since 0.1.0
 *
 * @param array $input Validated input.
 * @return array Usage rows.
 */
function atme_ability_get_usage( $input ) {
	return atme_media_usage( (int) $input['id'] );
}

/**
 * Alt text, for machines.
 *
 * @since 0.1.0
 *
 * @param array $input Validated input.
 * @return bool|WP_Error True on success.
 */
function atme_ability_set_alt( $input ) {
	$id = (int) $input['id'];

	if ( 'attachment' !== get_post_type( $id ) ) {
		return new WP_Error( 'atme_not_an_attachment', __( 'No such media item.', 'allterrain-maia' ) );
	}

	update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( (string) $input['alt'] ) );
	atme_record_change( $id, 'updated' );

	return true;
}

/**
 * Convert, for machines.
 *
 * @since 0.1.0
 *
 * @param array $input Validated input.
 * @return int|WP_Error The resulting attachment ID.
 */
function atme_ability_convert( $input ) {
	$args = array(
		'format'  => (string) $input['format'],
		'quality' => (int) ( $input['quality'] ?? 82 ),
	);

	if ( ! empty( $input['replace'] ) ) {
		$result = atme_convert_replace( (int) $input['id'], $args );

		return is_wp_error( $result ) ? $result : (int) $input['id'];
	}

	return atme_convert( (int) $input['id'], $args );
}

/**
 * Folders, for machines.
 *
 * @since 0.1.0
 *
 * @return array Folder rows.
 */
function atme_ability_list_folders() {
	return atme_folder_tree();
}

/**
 * Filing, for machines.
 *
 * @since 0.1.0
 *
 * @param array $input Validated input.
 * @return bool|WP_Error True on success.
 */
function atme_ability_file_media( $input ) {
	return atme_file_into_folder( (array) $input['ids'], (int) $input['folder'] );
}

/**
 * The scan, for machines.
 *
 * @since 0.1.0
 *
 * @param array $input Validated input.
 * @return array Chunk result.
 */
function atme_ability_scan( $input ) {
	return atme_wizard_scan_chunk( (int) ( $input['offset'] ?? 0 ), (int) ( $input['limit'] ?? 25 ) );
}
