<?php
/**
 * The content model: taxonomy, collection type, meta.
 *
 * @package AllTerrain_Media_Explorer
 */

/**
 * What `atme_register_content_model()` puts into WordPress.
 *
 * @group allterrain-media-explorer
 */
class Tests_ATME_Content_Model extends WP_UnitTestCase {

	/**
	 * @covers ::atme_register_content_model
	 */
	public function test_folders_are_a_hierarchical_taxonomy_on_attachments() {
		$taxonomy = get_taxonomy( ATME_FOLDER_TAX );

		$this->assertNotFalse( $taxonomy );
		$this->assertTrue( $taxonomy->hierarchical );
		$this->assertContains( 'attachment', $taxonomy->object_type );
		$this->assertTrue( $taxonomy->show_in_rest );
		$this->assertSame( 'atme-folders', $taxonomy->rest_base );
	}

	/**
	 * @covers ::atme_register_content_model
	 */
	public function test_filing_media_asks_for_the_media_capability() {
		$taxonomy = get_taxonomy( ATME_FOLDER_TAX );

		$this->assertSame( 'upload_files', $taxonomy->cap->assign_terms );
		$this->assertSame( 'upload_files', $taxonomy->cap->manage_terms );
	}

	/**
	 * @covers ::atme_register_content_model
	 */
	public function test_collections_are_a_post_type_with_rest_on() {
		$type = get_post_type_object( ATME_COLLECTION_TYPE );

		$this->assertNotNull( $type );
		$this->assertTrue( $type->show_in_rest );
		$this->assertSame( 'atme-collections', $type->rest_base );
		$this->assertFalse( $type->public );
	}

	/**
	 * @covers ::atme_register_content_model
	 */
	public function test_provenance_meta_is_registered_with_rest_schemas() {
		// The suite wipes the meta registry between tests; registration is
		// idempotent, so run it the way `init` would.
		atme_register_content_model();

		$keys = get_registered_meta_keys( 'post', 'attachment' );

		$this->assertArrayHasKey( ATME_META_CONVERTED_FROM, $keys );
		$this->assertArrayHasKey( ATME_META_CONVERSIONS, $keys );
		$this->assertNotEmpty( $keys[ ATME_META_CONVERTED_FROM ]['show_in_rest'] );
	}

	/**
	 * @covers ::atme_register_content_model
	 */
	public function test_versions_and_hashes_stay_out_of_rest() {
		atme_register_content_model();

		$keys = get_registered_meta_keys( 'post', 'attachment' );

		$this->assertArrayNotHasKey( ATME_META_VERSIONS, $keys );
		$this->assertArrayHasKey( ATME_META_HASH, $keys );
		$this->assertEmpty( $keys[ ATME_META_HASH ]['show_in_rest'] );
	}

	/**
	 * @covers ::atme_can_upload
	 */
	public function test_the_capability_gate_is_the_media_librarys_own() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
		$this->assertTrue( atme_can_upload() );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertFalse( atme_can_upload() );
	}
}
