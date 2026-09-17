<?php
/**
 * The `atme/v1` REST namespace.
 *
 * Core REST already browses, edits and deletes media; none of that is
 * duplicated here. These routes exist for the verbs core cannot say in one
 * round trip: convert a file, replace one in place, roll back, ask who uses
 * it, sweep the library, work the folder tree.
 *
 * Every route declares a permission callback and typed args; callbacks are
 * thin over the helpers, so the abilities and the UI cannot drift from them.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

add_action( 'rest_api_init', 'atme_register_rest_routes' );

/**
 * Registers every route.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_register_rest_routes() {
	$id_arg = array(
		'type'              => 'integer',
		'required'          => true,
		'minimum'           => 1,
		'description'       => __( 'Attachment ID.', 'allterrain-maia' ),
		'sanitize_callback' => 'absint',
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/convert',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atme_rest_convert',
			'permission_callback' => 'atme_can_edit_media',
			'args'                => array(
				'id'         => $id_arg,
				'format'     => array(
					'type'        => 'string',
					'required'    => true,
					'enum'        => array_keys( atme_known_formats() ),
					'description' => __( 'Target format.', 'allterrain-maia' ),
				),
				'quality'    => array(
					'type'    => 'integer',
					'default' => 82,
					'minimum' => 1,
					'maximum' => 100,
				),
				'strip_meta' => array(
					'type'    => 'boolean',
					'default' => false,
				),
				'max_width'  => array(
					'type'    => 'integer',
					'default' => 0,
					'minimum' => 0,
				),
				'rotate'     => array(
					'type'        => 'integer',
					'default'     => 0,
					'enum'        => array( 0, 90, 180, 270 ),
					'description' => __( 'Rotate clockwise by this many degrees while converting.', 'allterrain-maia' ),
				),
				'replace'    => array(
					'type'        => 'boolean',
					'default'     => false,
					'description' => __( 'Convert in place instead of as a copy.', 'allterrain-maia' ),
				),
			),
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/replace/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atme_rest_replace',
			'permission_callback' => 'atme_can_edit_media',
			'args'                => array( 'id' => $id_arg ),
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/versions/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'atme_rest_versions',
				'permission_callback' => 'atme_can_edit_media',
				'args'                => array( 'id' => $id_arg ),
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'atme_rest_rollback',
				'permission_callback' => 'atme_can_edit_media',
				'args'                => array(
					'id'   => $id_arg,
					'file' => array(
						'type'        => 'string',
						'required'    => true,
						'description' => __( 'The version’s stored name, from the history list.', 'allterrain-maia' ),
					),
				),
			),
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/usage/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'atme_rest_usage',
			'permission_callback' => 'atme_can_edit_media',
			'args'                => array( 'id' => $id_arg ),
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/facts/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'atme_rest_facts',
			'permission_callback' => 'atme_can_edit_media',
			'args'                => array( 'id' => $id_arg ),
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/regenerate',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atme_rest_regenerate',
			'permission_callback' => 'atme_can_edit_media',
			'args'                => array( 'id' => $id_arg ),
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/folders',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'atme_rest_folders',
				'permission_callback' => 'atme_can_upload',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'atme_rest_create_folder',
				'permission_callback' => 'atme_can_upload',
				'args'                => array(
					'name'   => array(
						'type'              => 'string',
						'required'          => true,
						'sanitize_callback' => 'sanitize_text_field',
					),
					'parent' => array(
						'type'              => 'integer',
						'default'           => 0,
						'minimum'           => 0,
						'sanitize_callback' => 'absint',
					),
				),
			),
		)
	);

	$file_args = array(
		'ids'    => array(
			'type'        => 'array',
			'required'    => true,
			'items'       => array(
				'type'    => 'integer',
				'minimum' => 1,
			),
			'description' => __( 'Attachment IDs.', 'allterrain-maia' ),
		),
		'folder' => array(
			'type'              => 'integer',
			'required'          => true,
			'minimum'           => 1,
			'sanitize_callback' => 'absint',
		),
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/folders/file',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atme_rest_file_into_folder',
			'permission_callback' => 'atme_can_edit_media_batch',
			'args'                => $file_args,
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/folders/unfile',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atme_rest_unfile_from_folder',
			'permission_callback' => 'atme_can_edit_media_batch',
			'args'                => $file_args,
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/duplicates',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'atme_rest_duplicates',
			'permission_callback' => 'atme_can_upload',
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/scan',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'atme_rest_scan',
			'permission_callback' => 'atme_can_upload',
			'args'                => array(
				'offset' => array(
					'type'              => 'integer',
					'default'           => 0,
					'minimum'           => 0,
					'sanitize_callback' => 'absint',
				),
				'limit'  => array(
					'type'              => 'integer',
					'default'           => 25,
					'minimum'           => 1,
					'maximum'           => 50,
					'sanitize_callback' => 'absint',
				),
			),
		)
	);

	register_rest_route(
		ATME_REST_NAMESPACE,
		'/wizard-state',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'atme_rest_wizard_state',
				'permission_callback' => 'atme_can_upload',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'atme_rest_save_wizard_state',
				'permission_callback' => 'atme_can_upload',
				'args'                => array(
					'state' => array(
						'type'        => array( 'object', 'null' ),
						'required'    => true,
						'description' => __( 'The wizard’s resumable state, or null to clear it.', 'allterrain-maia' ),
					),
				),
			),
		)
	);
}

/**
 * POST /convert — convert as a copy, or in place.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error Response.
 */
function atme_rest_convert( $request ) {
	$args = array(
		'format'     => $request['format'],
		'quality'    => $request['quality'],
		'strip_meta' => $request['strip_meta'],
		'max_width'  => $request['max_width'],
		'rotate'     => $request['rotate'],
	);

	if ( $request['replace'] ) {
		$result = atme_convert_replace( (int) $request['id'], $args );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response(
			array(
				'id'       => (int) $request['id'],
				'replaced' => true,
				'facts'    => atme_file_facts( (int) $request['id'] ),
			)
		);
	}

	$new_id = atme_convert( (int) $request['id'], $args );

	if ( is_wp_error( $new_id ) ) {
		return $new_id;
	}

	return rest_ensure_response(
		array(
			'id'       => (int) $new_id,
			'replaced' => false,
			'facts'    => atme_file_facts( (int) $new_id ),
		)
	);
}

/**
 * POST /replace/{id} — swap the file behind an attachment.
 *
 * The file arrives as a multipart upload named `file`. It goes through
 * `wp_handle_upload` first, so type checks and size limits are WordPress's
 * own, then into {@see atme_replace()}.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error Response.
 */
function atme_rest_replace( $request ) {
	$files = $request->get_file_params();

	if ( empty( $files['file'] ) ) {
		return new WP_Error(
			'atme_no_file',
			__( 'Send the replacement as a multipart field named “file”.', 'allterrain-maia' ),
			array( 'status' => 400 )
		);
	}

	if ( (int) $files['file']['size'] > wp_max_upload_size() ) {
		return new WP_Error( 'atme_upload_too_large', __( 'The replacement exceeds this site’s upload limit.', 'allterrain-maia' ), array( 'status' => 400 ) );
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';

	$handled = wp_handle_upload( $files['file'], array( 'test_form' => false ) );

	if ( isset( $handled['error'] ) ) {
		return new WP_Error( 'atme_upload_failed', $handled['error'], array( 'status' => 400 ) );
	}

	$result = atme_replace(
		(int) $request['id'],
		$handled['file'],
		array( 'mime' => (string) $handled['type'] )
	);

	if ( is_wp_error( $result ) ) {
		wp_delete_file( $handled['file'] );
		return $result;
	}

	return rest_ensure_response(
		array(
			'id'    => (int) $request['id'],
			'facts' => atme_file_facts( (int) $request['id'] ),
		)
	);
}

/**
 * GET /versions/{id} — the stash, newest first.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response Response.
 */
function atme_rest_versions( $request ) {
	return rest_ensure_response( atme_version_history( (int) $request['id'] ) );
}

/**
 * POST /versions/{id} — roll back to a stashed version.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error Response.
 */
function atme_rest_rollback( $request ) {
	$result = atme_rollback( (int) $request['id'], (string) $request['file'] );

	if ( is_wp_error( $result ) ) {
		return $result;
	}

	return rest_ensure_response(
		array(
			'id'    => (int) $request['id'],
			'facts' => atme_file_facts( (int) $request['id'] ),
		)
	);
}

/**
 * GET /usage/{id} — every place the file is used.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response Response.
 */
function atme_rest_usage( $request ) {
	return rest_ensure_response( atme_media_usage( (int) $request['id'] ) );
}

/**
 * GET /facts/{id} — file facts and history depth for the inspector.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response Response.
 */
function atme_rest_facts( $request ) {
	$id = (int) $request['id'];

	return rest_ensure_response(
		array(
			'facts'         => atme_file_facts( $id ),
			'versions'      => count( atme_versions_of( $id ) ),
			'convertedFrom' => (int) get_post_meta( $id, ATME_META_CONVERTED_FROM, true ),
			'conversions'   => array_map( 'intval', (array) get_post_meta( $id, ATME_META_CONVERSIONS, true ) ),
		)
	);
}

/**
 * POST /regenerate — rebuild an attachment's sub-sizes.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error Response.
 */
function atme_rest_regenerate( $request ) {
	$result = atme_regenerate_thumbnails( (int) $request['id'] );

	if ( is_wp_error( $result ) ) {
		return $result;
	}

	return rest_ensure_response( array( 'id' => (int) $request['id'] ) );
}

/**
 * GET /folders — the tree.
 *
 * @since 0.1.0
 *
 * @return WP_REST_Response Response.
 */
function atme_rest_folders() {
	return rest_ensure_response( atme_folder_tree() );
}

/**
 * POST /folders — a new folder.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error Response.
 */
function atme_rest_create_folder( $request ) {
	$created = atme_create_folder( (string) $request['name'], (int) $request['parent'] );

	if ( is_wp_error( $created ) ) {
		return $created;
	}

	return rest_ensure_response( array( 'id' => $created ) );
}

/**
 * POST /folders/file — file attachments into a folder.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error Response.
 */
function atme_rest_file_into_folder( $request ) {
	$result = atme_file_into_folder( (array) $request['ids'], (int) $request['folder'] );

	if ( is_wp_error( $result ) ) {
		return $result;
	}

	return rest_ensure_response( array( 'filed' => count( (array) $request['ids'] ) ) );
}

/**
 * POST /folders/unfile — take attachments out of a folder.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error Response.
 */
function atme_rest_unfile_from_folder( $request ) {
	$result = atme_unfile_from_folder( (array) $request['ids'], (int) $request['folder'] );

	if ( is_wp_error( $result ) ) {
		return $result;
	}

	return rest_ensure_response( array( 'unfiled' => count( (array) $request['ids'] ) ) );
}

/**
 * GET /scan — one wizard chunk.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response Response.
 */
function atme_rest_scan( $request ) {
	return rest_ensure_response( atme_wizard_scan_chunk( (int) $request['offset'], (int) $request['limit'] ) );
}

/**
 * GET /wizard-state — the resumable sweep, if one is mid-flight.
 *
 * @since 0.1.0
 *
 * @return WP_REST_Response Response.
 */
function atme_rest_wizard_state() {
	return rest_ensure_response( array( 'state' => atme_wizard_state() ) );
}

/**
 * POST /wizard-state — keep or clear the sweep.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response Response.
 */
function atme_rest_save_wizard_state( $request ) {
	$state = $request['state'];

	atme_wizard_save_state( is_array( $state ) ? $state : null );

	return rest_ensure_response( array( 'saved' => true ) );
}

/**
 * GET /duplicates — files sharing a hash, plus how much of the library is hashed.
 *
 * @since 0.1.0
 *
 * @return WP_REST_Response Response.
 */
function atme_rest_duplicates() {
	return rest_ensure_response( atme_duplicate_groups() );
}
