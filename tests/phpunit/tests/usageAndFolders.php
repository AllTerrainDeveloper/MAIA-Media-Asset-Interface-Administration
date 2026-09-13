<?php
/**
 * Usage scanning, folders, smart views, duplicates.
 *
 * @package AllTerrain_Media_Explorer
 */

/**
 * Where files are used, and how they are organized.
 *
 * @group allterrain-media-explorer
 */
class Tests_ATME_Usage_And_Folders extends WP_UnitTestCase {
	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}


	/**
	 * @covers ::atme_media_usage
	 */
	public function test_a_featured_image_is_reported_with_its_post() {
		$attachment = self::factory()->attachment->create();
		$post       = self::factory()->post->create( array( 'post_title' => 'The launch post' ) );

		// Straight meta: the factory attachment has no image file, and
		// `set_post_thumbnail()` refuses a thumbnail it cannot render.
		update_post_meta( $post, '_thumbnail_id', $attachment );

		$rows = atme_media_usage( $attachment );

		$this->assertCount( 1, $rows );
		$this->assertSame( $post, $rows[0]['postId'] );
		$this->assertSame( 'featured', $rows[0]['usedAs'] );
	}

	/**
	 * @covers ::atme_media_usage
	 */
	public function test_an_id_stamped_content_reference_is_found() {
		$attachment = self::factory()->attachment->create();
		$post       = self::factory()->post->create(
			array(
				'post_content' => '<img class="wp-image-' . $attachment . '" src="x.jpg" />',
			)
		);

		$rows = atme_media_usage( $attachment );

		$this->assertSame( $post, $rows[0]['postId'] );
		$this->assertSame( 'content', $rows[0]['usedAs'] );
	}

	/**
	 * @covers ::atme_media_usage
	 */
	public function test_an_unused_file_reports_no_rows() {
		$attachment = self::factory()->attachment->create();

		$this->assertSame( array(), atme_media_usage( $attachment ) );
		$this->assertFalse( atme_is_used( $attachment ) );
	}

	/**
	 * @covers ::atme_media_usage
	 */
	public function test_usage_rows_are_filterable() {
		$attachment = self::factory()->attachment->create();

		add_filter(
			'atme_media_usage',
			static function ( $rows ) {
				$rows[] = array( 'postId' => 0, 'usedAs' => 'builder' );

				return $rows;
			}
		);

		$rows = atme_media_usage( $attachment );

		$this->assertSame( 'builder', end( $rows )['usedAs'] );

		remove_all_filters( 'atme_media_usage' );
	}

	/**
	 * @covers ::atme_create_folder
	 * @covers ::atme_file_into_folder
	 * @covers ::atme_unfile_from_folder
	 */
	public function test_filing_is_additive_and_unfiling_removes_one_label() {
		$attachment = self::factory()->attachment->create();
		$trips      = atme_create_folder( 'Trips' );
		$portraits  = atme_create_folder( 'Portraits' );

		atme_file_into_folder( array( $attachment ), $trips );
		atme_file_into_folder( array( $attachment ), $portraits );

		$folders = wp_get_object_terms( $attachment, ATME_FOLDER_TAX, array( 'fields' => 'ids' ) );

		$this->assertEqualSets( array( $trips, $portraits ), $folders );

		atme_unfile_from_folder( array( $attachment ), $trips );

		$folders = wp_get_object_terms( $attachment, ATME_FOLDER_TAX, array( 'fields' => 'ids' ) );

		$this->assertEqualSets( array( $portraits ), $folders );
	}

	/**
	 * @covers ::atme_create_folder
	 */
	public function test_a_folder_needs_a_name_and_a_live_parent() {
		$this->assertWPError( atme_create_folder( '   ' ) );
		$this->assertWPError( atme_create_folder( 'Orphan', 424242 ) );
	}

	/**
	 * @covers ::atme_folder_tree
	 */
	public function test_the_tree_reports_parents_so_the_client_can_nest() {
		$parent = atme_create_folder( 'Year' );
		$child  = atme_create_folder( 'Summer', $parent );

		$rows  = atme_folder_tree();
		$byId  = array_column( $rows, null, 'id' );

		$this->assertSame( 0, $byId[ $parent ]['parent'] );
		$this->assertSame( $parent, $byId[ $child ]['parent'] );
	}

	/**
	 * @covers ::atme_folder_tree
	 */
	public function test_folder_counts_match_media_for_unattached_and_draft_parent_files() {
		$folder = atme_create_folder( 'Products' );
		foreach ( array( 0, self::factory()->post->create( array( 'post_status' => 'publish' ) ), self::factory()->post->create( array( 'post_status' => 'draft' ) ) ) as $parent ) {
			$attachment = self::factory()->attachment->create( array( 'post_parent' => $parent, 'post_status' => 'inherit' ) );
			atme_file_into_folder( array( $attachment ), $folder );
		}
		$request = new WP_REST_Request( 'GET', '/wp/v2/media' );
		$request->set_param( 'atme-folders', $folder );
		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertCount( 3, $response->get_data() );
		$rows = array_column( atme_folder_tree(), null, 'id' );
		$this->assertSame( count( $response->get_data() ), $rows[ $folder ]['count'] );
	}

	/**
	 * @covers ::atme_folder_tree
	 */
	public function test_folder_counts_are_direct_and_refresh_after_membership_and_status_changes() {
		$folder = atme_create_folder( 'Products' );
		$child  = atme_create_folder( 'Summer', $folder );
		$empty  = atme_create_folder( 'Empty' );
		$first  = self::factory()->attachment->create( array( 'post_status' => 'inherit' ) );
		$second = self::factory()->attachment->create( array( 'post_status' => 'inherit' ) );
		atme_file_into_folder( array( $first ), $folder );
		atme_file_into_folder( array( $first, $second ), $child );
		$rows = array_column( atme_folder_tree(), null, 'id' );
		$this->assertSame( 1, $rows[ $folder ]['count'] );
		$this->assertSame( 2, $rows[ $child ]['count'] );
		$this->assertSame( 0, $rows[ $empty ]['count'] );
		atme_unfile_from_folder( array( $first ), $folder );
		wp_update_post( array( 'ID' => $second, 'post_status' => 'trash' ) );
		$rows = array_column( atme_folder_tree(), null, 'id' );
		$this->assertSame( 0, $rows[ $folder ]['count'] );
		$this->assertSame( 1, $rows[ $child ]['count'] );
		wp_update_post( array( 'ID' => $second, 'post_status' => 'inherit' ) );
		$rows = array_column( atme_folder_tree(), null, 'id' );
		$this->assertSame( 2, $rows[ $child ]['count'] );
	}

	/**
	 * @covers ::atme_folder_tree
	 */
	public function test_folder_counts_include_memberships_beyond_the_first_batch() {
		$folder = atme_create_folder( 'Large folder' );
		$files  = self::factory()->attachment->create_many( 501, array( 'post_status' => 'inherit' ) );
		atme_file_into_folder( $files, $folder );
		$rows = array_column( atme_folder_tree(), null, 'id' );
		$this->assertSame( 501, $rows[ $folder ]['count'] );
	}

	/**
	 * @covers ::atme_folder_tree
	 */
	public function test_folder_counts_do_not_reveal_media_hidden_by_rest_read_permissions() {
		$owner  = get_current_user_id();
		$folder = atme_create_folder( 'Private project' );
		$parent = self::factory()->post->create( array( 'post_status' => 'private', 'post_author' => $owner ) );
		$file   = self::factory()->attachment->create( array( 'post_status' => 'inherit', 'post_parent' => $parent, 'post_author' => $owner ) );
		atme_file_into_folder( array( $file ), $folder );
		$rows = array_column( atme_folder_tree(), null, 'id' );
		$this->assertSame( 1, $rows[ $folder ]['count'] );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
		$request = new WP_REST_Request( 'GET', '/wp/v2/media' );
		$request->set_param( 'atme-folders', $folder );
		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertCount( 0, $response->get_data() );
		$rows = array_column( atme_folder_tree(), null, 'id' );
		$this->assertSame( 0, $rows[ $folder ]['count'] );
	}

	/**
	 * @covers ::atme_register_content_model
	 */
	public function test_folder_rest_deletion_keeps_media_and_promotes_children() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
		$parent     = atme_create_folder( 'Parent' );
		$folder     = atme_create_folder( 'Products', $parent );
		$child      = atme_create_folder( 'Summer', $folder );
		$other      = atme_create_folder( 'Other' );
		$attachment = self::factory()->attachment->create();
		atme_file_into_folder( array( $attachment ), $folder );
		atme_file_into_folder( array( $attachment ), $other );
		atme_file_into_folder( array( $attachment ), $child );

		$request = new WP_REST_Request( 'DELETE', '/wp/v2/atme-folders/' . $folder );
		$request->set_param( 'force', true );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['deleted'] );
		$this->assertNull( term_exists( $folder, ATME_FOLDER_TAX ) );
		$this->assertSame( $parent, (int) get_term( $child, ATME_FOLDER_TAX )->parent );
		$this->assertSame( 'attachment', get_post_type( $attachment ) );
		$this->assertEqualSets( array( $other, $child ), wp_get_object_terms( $attachment, ATME_FOLDER_TAX, array( 'fields' => 'ids' ) ) );
	}

	/**
	 * @covers ::atme_register_content_model
	 */
	public function test_folder_rest_deletion_requires_taxonomy_permission_and_a_live_folder() {
		$folder = atme_create_folder( 'Products' );
		$request = new WP_REST_Request( 'DELETE', '/wp/v2/atme-folders/' . $folder );
		$request->set_param( 'force', true );
		wp_set_current_user( 0 );
		$this->assertSame( 401, rest_do_request( $request )->get_status() );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertSame( 403, rest_do_request( $request )->get_status() );
		$this->assertNotNull( term_exists( $folder, ATME_FOLDER_TAX ) );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$this->assertSame( 200, rest_do_request( $request )->get_status() );
		$this->assertSame( 404, rest_do_request( $request )->get_status() );
	}

	/**
	 * @covers ::atme_rest_create_folder
	 */
	public function test_rest_creation_distinguishes_top_level_and_child_folders() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
		$products = atme_create_folder( 'Products' );
		foreach ( array( 0, $products ) as $parent ) {
			$request = new WP_REST_Request( 'POST', '/atme/v1/folders' );
			$request->set_param( 'name', $parent ? 'Summer' : 'Campaigns' );
			$request->set_param( 'parent', $parent );
			$response = rest_do_request( $request );
			$this->assertSame( 200, $response->get_status() );
			$this->assertSame( $parent, (int) get_term( $response->get_data()['id'], ATME_FOLDER_TAX )->parent );
		}
	}

	/**
	 * @covers ::atme_rest_attachment_query
	 */
	public function test_the_missing_alt_view_narrows_the_query() {
		$request = new WP_REST_Request( 'GET', '/wp/v2/media' );

		$request->set_param( 'atme_view', 'missing-alt' );

		$args = atme_rest_attachment_query( array(), $request );

		$this->assertSame( 'image', $args['post_mime_type'] );
		$this->assertSame( 'OR', $args['meta_query']['relation'] );
	}

	/**
	 * @covers ::atme_rest_attachment_query
	 */
	public function test_an_unknown_view_changes_nothing() {
		$request = new WP_REST_Request( 'GET', '/wp/v2/media' );

		$request->set_param( 'atme_view', '' );

		$this->assertSame( array( 'existing' => true ), atme_rest_attachment_query( array( 'existing' => true ), $request ) );
	}

	/**
	 * @covers ::atme_duplicate_groups
	 */
	public function test_duplicates_group_by_hash_and_report_coverage() {
		$first  = self::factory()->attachment->create();
		$second = self::factory()->attachment->create();
		$third  = self::factory()->attachment->create();

		update_post_meta( $first, ATME_META_HASH, 'aaa111' );
		update_post_meta( $second, ATME_META_HASH, 'aaa111' );
		update_post_meta( $third, ATME_META_HASH, 'bbb222' );

		$report = atme_duplicate_groups();

		$this->assertSame( 3, $report['hashed'] );
		$this->assertCount( 1, $report['groups'] );
		$this->assertEqualSets( array( $first, $second ), $report['groups'][0]['ids'] );
	}
}
