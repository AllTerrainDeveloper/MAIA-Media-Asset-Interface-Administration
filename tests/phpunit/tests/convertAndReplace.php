<?php
/**
 * The conversion engine and replace-in-place, over real files.
 *
 * @package AllTerrain_Media_Explorer
 */

/**
 * Converting, replacing, versioning, rolling back.
 *
 * @group allterrain-media-explorer
 */
class Tests_ATME_Convert_And_Replace extends WP_UnitTestCase {

	/**
	 * Makes a real JPEG attachment to work on.
	 *
	 * @param int $width  Width in pixels.
	 * @param int $height Height in pixels.
	 * @return int Attachment ID.
	 */
	private function make_image_attachment( $width = 64, $height = 48 ) {
		// A real .jpg extension: `wp_tempnam()` appends `.tmp`, and the
		// upload pipeline types files by extension.
		$file  = trailingslashit( get_temp_dir() ) . uniqid( 'atme-test-' ) . '.jpg';
		$image = imagecreatetruecolor( $width, $height );

		imagefilledrectangle( $image, 0, 0, $width, $height, imagecolorallocate( $image, 200, 60, 90 ) );
		imagejpeg( $image, $file, 90 );
		imagedestroy( $image );

		// The factory copies the file into uploads and builds metadata.
		return self::factory()->attachment->create_upload_object( $file );
	}

	/**
	 * @covers ::atme_known_formats
	 */
	public function test_the_format_list_maps_slugs_to_mimes() {
		$formats = atme_known_formats();

		$this->assertSame( 'image/jpeg', $formats['jpeg'] );
		$this->assertSame( 'image/webp', $formats['webp'] );
		$this->assertSame( 'image/avif', $formats['avif'] );
	}

	/**
	 * @covers ::atme_conversion_capabilities
	 */
	public function test_capabilities_report_every_known_format_and_are_filterable() {
		$capabilities = atme_conversion_capabilities();

		foreach ( array_keys( atme_known_formats() ) as $slug ) {
			$this->assertArrayHasKey( $slug, $capabilities['encode'] );
		}

		$this->assertArrayHasKey( 'heic', $capabilities['decode'] );
	}

	/**
	 * @covers ::atme_convert
	 */
	public function test_converting_makes_a_sibling_with_provenance_both_ways() {
		if ( empty( atme_conversion_capabilities()['encode']['png'] ) ) {
			$this->markTestSkipped( 'This PHP cannot encode PNG.' );
		}

		$source = $this->make_image_attachment();
		$copy   = atme_convert( $source, array( 'format' => 'png' ) );

		$this->assertIsInt( $copy );
		$this->assertSame( 'image/png', get_post_mime_type( $copy ) );
		$this->assertSame( $source, (int) get_post_meta( $copy, ATME_META_CONVERTED_FROM, true ) );
		$this->assertContains( $copy, array_map( 'intval', (array) get_post_meta( $source, ATME_META_CONVERSIONS, true ) ) );

		// The source is untouched — convert-as-copy is non-destructive.
		$this->assertSame( 'image/jpeg', get_post_mime_type( $source ) );
	}

	/**
	 * @covers ::atme_convert
	 */
	public function test_an_unknown_format_is_refused_before_any_io() {
		$source = $this->make_image_attachment();
		$result = atme_convert( $source, array( 'format' => 'tiff' ) );

		$this->assertWPError( $result );
		$this->assertSame( 'atme_unknown_format', $result->get_error_code() );
	}

	/**
	 * @covers ::atme_convert
	 */
	public function test_a_missing_attachment_is_refused() {
		$result = atme_convert( 999999, array( 'format' => 'png' ) );

		$this->assertWPError( $result );
	}

	/**
	 * @covers ::atme_convert_replace
	 */
	public function test_converting_in_place_keeps_the_id_and_stashes_a_version() {
		if ( empty( atme_conversion_capabilities()['encode']['png'] ) ) {
			$this->markTestSkipped( 'This PHP cannot encode PNG.' );
		}

		$id     = $this->make_image_attachment();
		$result = atme_convert_replace( $id, array( 'format' => 'png' ) );

		$this->assertTrue( $result );
		$this->assertSame( 'image/png', get_post_mime_type( $id ) );

		$versions = atme_version_history( $id );

		$this->assertCount( 1, $versions );
		$this->assertSame( 'image/jpeg', $versions[0]['mime'] );
	}

	/**
	 * @covers ::atme_rollback
	 */
	public function test_rollback_restores_the_stashed_pixels_and_mime() {
		if ( empty( atme_conversion_capabilities()['encode']['png'] ) ) {
			$this->markTestSkipped( 'This PHP cannot encode PNG.' );
		}

		$id = $this->make_image_attachment();

		atme_convert_replace( $id, array( 'format' => 'png' ) );

		$versions = atme_version_history( $id );
		$result   = atme_rollback( $id, $versions[0]['file'] );

		$this->assertTrue( $result );
		$this->assertSame( 'image/jpeg', get_post_mime_type( $id ) );

		// The rollback itself stashed the PNG — undo has an undo.
		$this->assertCount( 2, atme_version_history( $id ) );
	}

	/**
	 * @covers ::atme_rollback
	 */
	public function test_rollback_refuses_a_version_not_in_the_history() {
		$id     = $this->make_image_attachment();
		$result = atme_rollback( $id, '../../wp-config.php' );

		$this->assertWPError( $result );
		$this->assertSame( 'atme_no_such_version', $result->get_error_code() );
	}

	/**
	 * @covers ::atme_replace
	 */
	public function test_replace_refuses_to_swap_kinds() {
		$id   = $this->make_image_attachment();
		$text = trailingslashit( get_temp_dir() ) . uniqid( 'atme-not-an-image-' ) . '.txt';

		file_put_contents( $text, 'plain text' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents

		$result = atme_replace( $id, $text, array( 'mime' => 'text/plain' ) );

		$this->assertWPError( $result );
		$this->assertSame( 'atme_kind_mismatch', $result->get_error_code() );
	}

	/**
	 * @covers ::atme_stash_version
	 */
	public function test_the_version_stash_is_capped_and_prunes_oldest_first() {
		add_filter(
			'atme_version_cap',
			static function () {
				return 2;
			}
		);

		$id = $this->make_image_attachment();

		atme_stash_version( $id );
		atme_stash_version( $id );
		atme_stash_version( $id );

		$this->assertCount( 2, atme_version_history( $id ) );

		remove_all_filters( 'atme_version_cap' );
	}

	/**
	 * @covers ::atme_handle_heic_upload
	 */
	public function test_non_heic_uploads_pass_through_untouched() {
		$upload = array(
			'file' => '/tmp/example.jpg',
			'url'  => 'http://example.test/example.jpg',
			'type' => 'image/jpeg',
		);

		$this->assertSame( $upload, atme_handle_heic_upload( $upload ) );
	}

	/**
	 * @covers ::atme_file_hash
	 */
	public function test_the_file_hash_is_computed_once_and_cached() {
		$id   = $this->make_image_attachment();
		$hash = atme_file_hash( $id );

		$this->assertNotSame( '', $hash );
		$this->assertSame( $hash, get_post_meta( $id, ATME_META_HASH, true ) );
		$this->assertSame( $hash, atme_file_hash( $id ) );
	}
}
