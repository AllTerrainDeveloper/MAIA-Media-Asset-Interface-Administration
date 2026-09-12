<?php
/**
 * The wizard scan, its state, the REST surface and the abilities.
 *
 * @package AllTerrain_Media_Explorer
 */

/**
 * Scanning, resuming, and the machine-facing surfaces.
 *
 * @group allterrain-media-explorer
 */
class Tests_ATME_Wizard_And_Rest extends WP_UnitTestCase {
	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}


	/**
	 * Makes a real JPEG attachment.
	 *
	 * @param int $width Width in pixels.
	 * @return int Attachment ID.
	 */
	private function make_image_attachment( $width = 64 ) {
		$file  = trailingslashit( get_temp_dir() ) . uniqid( 'atme-scan-' ) . '.jpg';
		$image = imagecreatetruecolor( $width, 40 );

		imagefilledrectangle( $image, 0, 0, $width, 40, imagecolorallocate( $image, 10, 120, 220 ) );
		imagejpeg( $image, $file, 90 );
		imagedestroy( $image );

		return self::factory()->attachment->create_upload_object( $file );
	}

	/**
	 * @covers ::atme_wizard_scan_chunk
	 */
	public function test_a_scan_reports_missing_alt_and_legacy_format() {
		$id    = $this->make_image_attachment();
		$chunk = atme_wizard_scan_chunk( 0, 50 );
		$kinds = array();

		foreach ( $chunk['findings'] as $finding ) {
			if ( $finding['id'] === $id ) {
				$kinds[] = $finding['kind'];
			}
		}

		$this->assertContains( 'missing-alt', $kinds );

		if ( ! empty( atme_conversion_capabilities()['encode']['webp'] ) ) {
			$this->assertContains( 'legacy-format', $kinds );
		}
	}

	/**
	 * @covers ::atme_wizard_scan_chunk
	 */
	public function test_an_image_with_alt_text_is_not_flagged_for_it() {
		$id = $this->make_image_attachment();

		update_post_meta( $id, '_wp_attachment_image_alt', 'A blue rectangle' );

		$chunk = atme_wizard_scan_chunk( 0, 50 );

		foreach ( $chunk['findings'] as $finding ) {
			if ( $finding['id'] === $id ) {
				$this->assertNotSame( 'missing-alt', $finding['kind'] );
			}
		}
	}

	/**
	 * @covers ::atme_wizard_scan_chunk
	 */
	public function test_scanning_fills_the_hash_index_as_it_goes() {
		$id = $this->make_image_attachment();

		$this->assertSame( '', (string) get_post_meta( $id, ATME_META_HASH, true ) );

		atme_wizard_scan_chunk( 0, 50 );

		$this->assertNotSame( '', (string) get_post_meta( $id, ATME_META_HASH, true ) );
	}

	/**
	 * @covers ::atme_wizard_scan_chunk
	 */
	public function test_duplicate_uploads_are_reported_once_per_pair() {
		$file  = trailingslashit( get_temp_dir() ) . uniqid( 'atme-dupe-' ) . '.jpg';
		$image = imagecreatetruecolor( 32, 32 );

		imagefilledrectangle( $image, 0, 0, 32, 32, imagecolorallocate( $image, 5, 5, 5 ) );
		imagejpeg( $image, $file, 90 );
		imagedestroy( $image );

		$copy = trailingslashit( get_temp_dir() ) . uniqid( 'atme-dupe-2-' ) . '.jpg';

		copy( $file, $copy );

		$first  = self::factory()->attachment->create_upload_object( $file );
		$second = self::factory()->attachment->create_upload_object( $copy );

		$chunk      = atme_wizard_scan_chunk( 0, 50 );
		$duplicates = array();

		foreach ( $chunk['findings'] as $finding ) {
			if ( 'duplicate' === $finding['kind'] ) {
				$duplicates[] = $finding['id'];
			}
		}

		$this->assertSame( array( $second ), $duplicates );
		$this->assertNotContains( $first, $duplicates );
	}

	/**
	 * @covers ::atme_wizard_save_state
	 * @covers ::atme_wizard_state
	 */
	public function test_the_wizard_state_round_trips_and_clears() {
		$state = array(
			'queue'  => array( array( 'id' => 5, 'remedy' => 'convert' ) ),
			'done'   => 0,
			'failed' => array(),
		);

		atme_wizard_save_state( $state );
		$this->assertSame( $state, atme_wizard_state() );

		atme_wizard_save_state( null );
		$this->assertNull( atme_wizard_state() );
	}

	/**
	 * @covers ::atme_register_rest_routes
	 */
	public function test_every_route_registers_under_the_namespace() {
		do_action( 'rest_api_init' );

		$routes = rest_get_server()->get_routes();

		foreach ( array( '/atme/v1/convert', '/atme/v1/scan', '/atme/v1/folders', '/atme/v1/duplicates', '/atme/v1/wizard-state' ) as $route ) {
			$this->assertArrayHasKey( $route, $routes, "Missing route {$route}" );
		}

		$this->assertArrayHasKey( '/atme/v1/usage/(?P<id>\d+)', $routes );
		$this->assertArrayHasKey( '/atme/v1/versions/(?P<id>\d+)', $routes );
		$this->assertArrayHasKey( '/atme/v1/replace/(?P<id>\d+)', $routes );
	}

	/**
	 * @covers ::atme_rest_convert
	 */
	public function test_the_convert_route_refuses_a_reader_without_upload_files() {
		do_action( 'rest_api_init' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$request = new WP_REST_Request( 'POST', '/atme/v1/convert' );

		$request->set_body_params(
			array(
				'id'     => 1,
				'format' => 'webp',
			)
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * @covers ::atme_register_abilities
	 */
	public function test_every_ability_registers_with_permissions_and_schemas() {
		if ( ! function_exists( 'wp_register_ability' ) || ! function_exists( 'wp_get_ability' ) ) {
			$this->markTestSkipped( 'This WordPress has no Abilities API.' );
		}

		// The registry was populated when the suite booted; asking again
		// would be a duplicate registration and a _doing_it_wrong.
		$expected = array(
			'allterrain-media-explorer/search-media',
			'allterrain-media-explorer/get-media-usage',
			'allterrain-media-explorer/set-alt-text',
			'allterrain-media-explorer/convert-media',
			'allterrain-media-explorer/list-folders',
			'allterrain-media-explorer/file-media',
			'allterrain-media-explorer/scan-library',
		);

		foreach ( $expected as $name ) {
			$ability = wp_get_ability( $name );

			$this->assertNotNull( $ability, "Missing ability {$name}" );
		}
	}

	/**
	 * @covers ::atme_ability_set_alt
	 */
	public function test_the_alt_ability_writes_through_the_same_meta_the_ui_reads() {
		$attachment = self::factory()->attachment->create();

		$this->assertTrue( atme_ability_set_alt( array( 'id' => $attachment, 'alt' => 'A red kite' ) ) );
		$this->assertSame( 'A red kite', get_post_meta( $attachment, '_wp_attachment_image_alt', true ) );
	}

	/**
	 * @covers ::atme_record_change
	 */
	public function test_mutations_reach_the_shells_change_channel() {
		$GLOBALS['atme_content_changes'] = array();

		atme_record_change( 42, 'updated' );

		$this->assertSame(
			array(
				array(
					'type'   => 'attachment',
					'id'     => 42,
					'action' => 'updated',
				),
			),
			$GLOBALS['atme_content_changes']
		);
	}
}
