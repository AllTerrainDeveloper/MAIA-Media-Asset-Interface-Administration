<?php
/** Regression cases from the AllTerrain Forms review lessons.
 * @package AllTerrain_Media_Explorer
 */
defined( 'ABSPATH' ) || exit;

/** @group allterrain-media-explorer */
class Tests_ATME_Review_Regressions extends WP_UnitTestCase {
	private $author;
	private $own;
	private $other;

	public function set_up() {
		parent::set_up();
		$this->author = self::factory()->user->create( array( 'role' => 'author' ) );
		$this->own = self::factory()->attachment->create( array( 'post_author' => $this->author ) );
		$this->other = self::factory()->attachment->create( array( 'post_author' => self::factory()->user->create( array( 'role' => 'administrator' ) ) ) );
		wp_set_current_user( $this->author );
	}

	/** @covers ::atme_can_edit_media */
	public function test_object_gate_checks_owner_type_and_anonymous_users() {
		$this->assertTrue( atme_can_edit_media( array( 'id' => $this->own ) ) );
		$this->assertFalse( atme_can_edit_media( array( 'id' => $this->other ) ) );
		$this->assertFalse( atme_can_edit_media( array( 'id' => self::factory()->post->create( array( 'post_author' => $this->author ) ) ) ) );
		$this->assertFalse( atme_can_edit_media( array( 'id' => array( 1 ) ) ) );
		wp_set_current_user( 0 );
		$this->assertFalse( atme_can_edit_media( array( 'id' => $this->own ) ) );
	}

	/** @covers ::atme_register_rest_routes */
	public function test_every_object_route_refuses_another_authors_attachment() {
		foreach ( array( array( 'POST', '/convert', array( 'format' => 'webp' ) ), array( 'POST', '/replace/' . $this->other, array() ), array( 'GET', '/versions/' . $this->other, array() ), array( 'POST', '/versions/' . $this->other, array( 'file' => 'anything.jpg' ) ), array( 'GET', '/usage/' . $this->other, array() ), array( 'GET', '/facts/' . $this->other, array() ), array( 'POST', '/regenerate', array() ) ) as $case ) {
			$request = new WP_REST_Request( $case[0], '/atme/v1' . $case[1] );
			$request->set_param( 'id', $this->other );
			foreach ( $case[2] as $key => $value ) {
				$request->set_param( $key, $value );
			}
			$this->assertSame( 403, rest_do_request( $request )->get_status(), $case[1] );
		}
		$request = new WP_REST_Request( 'GET', '/atme/v1/facts/' . $this->own );
		$this->assertSame( 200, rest_do_request( $request )->get_status() );
		$this->assertSame( 0, rest_do_request( $request )->get_data()['versions'] );
	}

	/** @covers ::atme_can_edit_media_batch */
	public function test_mixed_owner_batch_is_refused_before_any_filing() {
		$folder = atme_create_folder( 'Review' );
		$request = new WP_REST_Request( 'POST', '/atme/v1/folders/file' );
		$request->set_param( 'ids', array( $this->own, $this->other ) );
		$request->set_param( 'folder', $folder );
		$this->assertSame( 403, rest_do_request( $request )->get_status() );
		$this->assertSame( array(), wp_get_object_terms( $this->own, ATME_FOLDER_TAX ) );
		$request->set_param( 'ids', array( $this->own ) );
		$this->assertSame( 200, rest_do_request( $request )->get_status() );
	}

	/** @covers ::atme_register_abilities */
	public function test_ability_permission_callbacks_ask_about_the_input_object() {
		if ( ! function_exists( 'wp_get_ability' ) ) {
			$this->markTestSkipped( 'Abilities API requires WordPress 6.9+.' );
		}
		foreach ( array( 'get-media-usage', 'set-alt-text', 'convert-media' ) as $name ) {
			$ability = wp_get_ability( 'allterrain-media-explorer/' . $name );
			$this->assertNotNull( $ability );
			$this->assertNotSame( true, $ability->check_permissions( array( 'id' => $this->other ) ) );
			$this->assertTrue( $ability->check_permissions( array( 'id' => $this->own ) ) );
		}
	}

	/** @covers ::atme_media_usage */
	public function test_usage_does_not_disclose_private_posts_from_other_authors() {
		$post = self::factory()->post->create( array( 'post_status' => 'private', 'post_content' => '<img class="wp-image-' . $this->own . '">', 'post_author' => 999 ) );
		$this->assertSame( array(), atme_media_usage( $this->own ) );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$this->assertContains( $post, wp_list_pluck( atme_media_usage( $this->own ), 'postId' ) );
	}

	/** @covers ::atme_wizard_save_state
	 * @covers ::atme_wizard_state
	 */
	public function test_wizard_queue_is_private_and_sanitized_without_changing_types() {
		atme_wizard_save_state( array( 'done' => 1, 'title' => '<script>bad</script>Test' ) );
		$this->assertSame( array( 'done' => 1, 'title' => 'Test' ), atme_wizard_state() );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
		$this->assertNull( atme_wizard_state() );
		atme_wizard_save_state( null );
		wp_set_current_user( $this->author );
		$this->assertSame( 1, atme_wizard_state()['done'] );
	}

	/** @covers ::atme_rest_replace */
	public function test_replacement_respects_the_sites_upload_size_limit() {
		$limit = static function () { return 10; };
		add_filter( 'upload_size_limit', $limit );
		$request = new WP_REST_Request( 'POST', '/atme/v1/replace/' . $this->own );
		$request->set_file_params( array( 'file' => array( 'name' => 'photo.jpg', 'size' => 11 ) ) );
		$result = rest_do_request( $request );
		remove_filter( 'upload_size_limit', $limit );
		$this->assertSame( 400, $result->get_status() );
		$this->assertSame( 'atme_upload_too_large', $result->get_data()['code'] );
	}
	/** @covers ::atme_rest_replace */
	public function test_replacement_rejects_executable_names_and_disguised_image_bytes() {
		$override = static function ( $args ) { $args['test_upload'] = false; return $args; };
		add_filter( 'wp_handle_upload_overrides', $override );
		foreach ( array( 'payload.php', 'payload.phtml', 'payload.jpg' ) as $name ) {
			$file = wp_tempnam( $name );
			file_put_contents( $file, '<?php echo "not an image";' );
			$request = new WP_REST_Request( 'POST', '/atme/v1/replace/' . $this->own );
			$request->set_file_params( array( 'file' => array( 'name' => $name, 'type' => 'image/jpeg', 'tmp_name' => $file, 'error' => 0, 'size' => filesize( $file ) ) ) );
			$response = rest_do_request( $request );
			$this->assertSame( 400, $response->get_status(), $name );
			$this->assertSame( 'atme_upload_failed', $response->get_data()['code'], $name );
			wp_delete_file( $file );
		}
		remove_filter( 'wp_handle_upload_overrides', $override );
		$this->assertSame( array(), atme_versions_of( $this->own ) );
	}

}
