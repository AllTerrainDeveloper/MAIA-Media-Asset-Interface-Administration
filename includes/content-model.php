<?php
/**
 * The content model: a taxonomy, a post type, and meta with schemas.
 *
 * Nothing here invents storage. An attachment is a post WordPress already
 * has; folders are terms on it; a collection is a post whose body is a saved
 * query; versions and provenance are meta rows. The payoff is that REST,
 * `current_user_can()`, search, the trash and every plugin hooking
 * `save_post` already work on all of it.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'atme_register_content_model', 5 );

/**
 * Registers the folder taxonomy, the collection post type, and every meta key.
 *
 * On `init` at 5 so everything that names these — REST routes, the window
 * config, WP Explorer hooks — can rely on them existing by the default 10.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_register_content_model() {
	register_taxonomy(
		ATME_FOLDER_TAX,
		'attachment',
		array(
			'labels'             => array(
				'name'          => __( 'Media Folders', 'allterrain-maia' ),
				'singular_name' => __( 'Media Folder', 'allterrain-maia' ),
				'add_new_item'  => __( 'Add New Folder', 'allterrain-maia' ),
				'edit_item'     => __( 'Edit Folder', 'allterrain-maia' ),
				'search_items'  => __( 'Search Folders', 'allterrain-maia' ),
			),
			'public'             => false,
			'show_ui'            => true,
			'show_in_menu'       => false,
			'show_admin_column'  => true,
			'hierarchical'       => true,
			'show_in_rest'       => true,
			'rest_base'          => 'atme-folders',
			'query_var'          => false,
			'rewrite'            => false,
			'capabilities'       => array(
				// Filing media is a media capability, not a category one. Anyone
				// who can upload can organize what they uploaded; shaping the
				// tree itself asks the same.
				'manage_terms' => 'upload_files',
				'edit_terms'   => 'upload_files',
				'delete_terms' => 'upload_files',
				'assign_terms' => 'upload_files',
			),
		)
	);

	register_post_type(
		ATME_COLLECTION_TYPE,
		array(
			'labels'              => array(
				'name'          => __( 'Media Collections', 'allterrain-maia' ),
				'singular_name' => __( 'Media Collection', 'allterrain-maia' ),
			),
			'public'              => false,
			'show_ui'             => false,
			'show_in_rest'        => true,
			'rest_base'           => 'atme-collections',
			'supports'            => array( 'title', 'author', 'custom-fields' ),
			'has_archive'         => false,
			'exclude_from_search' => true,
			'capability_type'     => 'post',
			'map_meta_cap'        => true,
		)
	);

	register_post_meta(
		ATME_COLLECTION_TYPE,
		ATME_META_QUERY,
		array(
			'type'          => 'string',
			'description'   => __( 'The saved search this collection stands for, as JSON.', 'allterrain-maia' ),
			'single'        => true,
			'default'       => '',
			'show_in_rest'  => true,
			'auth_callback' => 'atme_can_upload',
		)
	);

	register_post_meta(
		'attachment',
		ATME_META_CONVERTED_FROM,
		array(
			'type'          => 'integer',
			'description'   => __( 'The attachment this file was converted from.', 'allterrain-maia' ),
			'single'        => true,
			'default'       => 0,
			'show_in_rest'  => true,
			'auth_callback' => 'atme_can_upload',
		)
	);

	register_post_meta(
		'attachment',
		ATME_META_CONVERSIONS,
		array(
			'type'          => 'array',
			'description'   => __( 'Attachments converted out of this file.', 'allterrain-maia' ),
			'single'        => true,
			'default'       => array(),
			'show_in_rest'  => array(
				'schema' => array(
					'type'  => 'array',
					'items' => array( 'type' => 'integer' ),
				),
			),
			'auth_callback' => 'atme_can_upload',
		)
	);

	// Versions and the file hash are deliberately *not* registered: they are
	// internal bookkeeping holding real file paths and digests, and
	// registering an array-typed meta without a REST schema is refused by
	// core anyway. Unregistered plain meta stays invisible to REST, which is
	// exactly the goal — the versions *endpoint* presents history in a shape
	// that does not leak server paths.
	register_post_meta(
		'attachment',
		ATME_META_HASH,
		array(
			'type'    => 'string',
			'single'  => true,
			'default' => '',
		)
	);
}

/**
 * Whether the current user can work the library.
 *
 * The one capability gate the whole plugin uses for media verbs. Deliberately
 * `upload_files` — the capability WordPress itself asks of the Media Library —
 * so a role that can use core's grid can use this one, and one that cannot,
 * cannot.
 *
 * @since 0.1.0
 *
 * @return bool True when the user can act on media.
 */
function atme_can_upload() {
	return current_user_can( 'upload_files' );
}
