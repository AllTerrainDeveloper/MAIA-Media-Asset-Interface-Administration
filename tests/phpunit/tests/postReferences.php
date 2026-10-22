<?php
/**
 * Moving posts to a converted file.
 *
 * @package AllTerrain_Media_Explorer
 */

/**
 * URL maps, content rewrites, candidates and the REST pair.
 *
 * @group allterrain-media-explorer
 */
class Tests_ATME_Post_References extends WP_UnitTestCase {

	/**
	 * An editor, so `edit_post` checks pass for posts they did not write.
	 *
	 * @var int
	 */
	private static $editor;

	/**
	 * @param WP_UnitTest_Factory $factory Factory.
	 */
	public static function wpSetUpBeforeClass( $factory ) {
		self::$editor = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$editor );
	}

	/**
	 * Makes a real JPEG attachment, big enough to get a sub-size.
	 *
	 * @return int Attachment ID.
	 */
	private function make_image_attachment() {
		$file  = trailingslashit( get_temp_dir() ) . uniqid( 'atme-ref-' ) . '.jpg';
		$image = imagecreatetruecolor( 400, 300 );

		imagefilledrectangle( $image, 0, 0, 400, 300, imagecolorallocate( $image, 30, 120, 200 ) );
		imagejpeg( $image, $file, 90 );
		imagedestroy( $image );

		return self::factory()->attachment->create_upload_object( $file );
	}

	/**
	 * Skips when this PHP cannot write PNG.
	 */
	private function require_png() {
		if ( empty( atme_conversion_capabilities()['encode']['png'] ) ) {
			$this->markTestSkipped( 'This PHP cannot encode PNG.' );
		}
	}

	/**
	 * A post embedding an attachment the way the block editor does.
	 *
	 * @param int $attachment_id Attachment.
	 * @return int Post ID.
	 */
	private function make_post_using( $attachment_id ) {
		$url = wp_get_attachment_url( $attachment_id );

		return self::factory()->post->create(
			array(
				'post_author'  => self::$editor,
				'post_content' => '<!-- wp:image {"id":' . $attachment_id . ',"sizeSlug":"full"} -->'
					. '<figure class="wp-block-image size-full"><img src="' . $url . '" alt="" class="wp-image-' . $attachment_id . '"/></figure>'
					. '<!-- /wp:image -->',
			)
		);
	}

	/**
	 * @covers ::atme_attachment_url_map
	 */
	public function test_the_url_map_names_full_and_every_sub_size() {
		$id  = $this->make_image_attachment();
		$map = atme_attachment_url_map( $id );

		$this->assertSame( wp_get_attachment_url( $id ), $map['full'] );
		$this->assertArrayHasKey( 'thumbnail', $map );
		$this->assertStringEndsWith( '.jpg', $map['thumbnail'] );
	}

	/**
	 * @covers ::atme_remember_previous_urls
	 * @covers ::atme_replace
	 */
	public function test_converting_in_place_remembers_the_outgoing_urls() {
		$this->require_png();

		$id     = $this->make_image_attachment();
		$before = atme_attachment_url_map( $id );

		$this->assertTrue( atme_convert_replace( $id, array( 'format' => 'png' ) ) );

		$maps = atme_previous_url_maps( $id );

		$this->assertCount( 1, $maps );
		$this->assertSame( $before, $maps[0] );
		$this->assertStringEndsWith( '.png', wp_get_attachment_url( $id ) );
	}

	/**
	 * @covers ::atme_rewrite_content_references
	 */
	public function test_a_copy_rewrite_moves_ids_without_clipping_longer_ones() {
		$content = '<!-- wp:image {"id":12,"sizeSlug":"large"} --><img src="https://example.test/a.jpg" class="wp-image-12"/><!-- /wp:image -->'
			. '<!-- wp:media-text {"mediaId":12} --><!-- /wp:media-text -->'
			. '<!-- wp:gallery {"ids":[7,12,123]} --><!-- /wp:gallery -->'
			. '<img data-id="12" class="wp-image-123"/>[gallery ids="12,120"]';

		list( $rewritten, $count ) = atme_rewrite_content_references(
			$content,
			12,
			99,
			array( 'https://example.test/a.jpg' => 'https://example.test/a.webp' )
		);

		$this->assertStringContainsString( '{"id":99,"sizeSlug":"large"}', $rewritten );
		$this->assertStringContainsString( 'https://example.test/a.webp', $rewritten );
		$this->assertStringContainsString( 'class="wp-image-99"', $rewritten );
		$this->assertStringContainsString( '{"mediaId":99}', $rewritten );
		$this->assertStringContainsString( '{"ids":[7,99,123]}', $rewritten );
		$this->assertStringContainsString( 'data-id="99"', $rewritten );
		$this->assertStringContainsString( '[gallery ids="99,120"]', $rewritten );

		// Attachment 123 is somebody else.
		$this->assertStringContainsString( 'wp-image-123', $rewritten );
		$this->assertSame( 7, $count );
	}

	/**
	 * @covers ::atme_rewrite_content_references
	 */
	public function test_an_in_place_rewrite_touches_urls_only() {
		list( $rewritten, $count ) = atme_rewrite_content_references(
			'<img src="https://example.test/a.jpg" class="wp-image-12"/>',
			12,
			12,
			array( 'https://example.test/a.jpg' => 'https://example.test/a.webp' )
		);

		$this->assertSame( '<img src="https://example.test/a.webp" class="wp-image-12"/>', $rewritten );
		$this->assertSame( 1, $count );
	}

	/**
	 * @covers ::atme_update_post_references
	 * @covers ::atme_reference_candidates
	 */
	public function test_a_copy_takes_over_the_content_and_the_featured_image() {
		$this->require_png();

		$source = $this->make_image_attachment();
		$post   = $this->make_post_using( $source );
		$cover  = self::factory()->post->create( array( 'post_author' => self::$editor ) );

		set_post_thumbnail( $cover, $source );

		$copy = atme_convert( $source, array( 'format' => 'png' ) );

		$candidates = wp_list_pluck( atme_reference_candidates( $source, $copy ), 'postId' );

		$this->assertEqualsCanonicalizing( array( $post, $cover ), $candidates );

		$result = atme_update_post_references( $post, $source, $copy );

		$this->assertTrue( $result['changed'] );
		$this->assertGreaterThan( 0, $result['replaced'] );

		$content = get_post_field( 'post_content', $post );

		$this->assertStringContainsString( '"id":' . $copy, $content );
		$this->assertStringContainsString( 'wp-image-' . $copy, $content );
		$this->assertStringContainsString( wp_get_attachment_url( $copy ), $content );
		$this->assertStringNotContainsString( wp_get_attachment_url( $source ), $content );

		// Undoable like any edit.
		$this->assertNotEmpty( wp_get_post_revisions( $post ) );

		$featured = atme_update_post_references( $cover, $source, $copy );

		$this->assertTrue( $featured['featured'] );
		$this->assertSame( $copy, (int) get_post_thumbnail_id( $cover ) );

		// Done means done: nothing is offered twice.
		$this->assertSame( array(), atme_reference_candidates( $source, $copy ) );
	}

	/**
	 * @covers ::atme_update_post_references
	 * @covers ::atme_reference_candidates
	 */
	public function test_in_place_moves_stale_urls_and_leaves_featured_only_posts_alone() {
		$this->require_png();

		$id    = $this->make_image_attachment();
		$post  = $this->make_post_using( $id );
		$cover = self::factory()->post->create( array( 'post_author' => self::$editor ) );
		$old   = wp_get_attachment_url( $id );

		set_post_thumbnail( $cover, $id );
		atme_convert_replace( $id, array( 'format' => 'png' ) );

		// The featured image stores an ID, which never moved.
		$this->assertSame( array( $post ), wp_list_pluck( atme_reference_candidates( $id, $id ), 'postId' ) );

		$result = atme_update_post_references( $post, $id, $id );

		$this->assertTrue( $result['changed'] );

		$content = get_post_field( 'post_content', $post );

		$this->assertStringNotContainsString( $old, $content );
		$this->assertStringContainsString( wp_get_attachment_url( $id ), $content );
		$this->assertStringContainsString( 'wp-image-' . $id, $content );
	}

	/**
	 * @covers ::atme_validate_reference_pair
	 */
	public function test_unrelated_attachments_are_not_a_pair() {
		$a = $this->make_image_attachment();
		$b = $this->make_image_attachment();

		$result = atme_update_post_references( $this->make_post_using( $a ), $a, $b );

		$this->assertWPError( $result );
		$this->assertSame( 'atme_not_a_conversion', $result->get_error_code() );
	}

	/**
	 * @covers ::atme_update_post_references
	 */
	public function test_a_post_the_user_cannot_edit_is_refused() {
		$id   = $this->make_image_attachment();
		$post = $this->make_post_using( $id );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		$result = atme_update_post_references( $post, $id, $id );

		$this->assertWPError( $result );
		$this->assertSame( 'atme_cannot_edit_post', $result->get_error_code() );
	}

	/**
	 * @covers ::atme_rest_reference_candidates
	 * @covers ::atme_rest_update_references
	 */
	public function test_the_rest_pair_lists_then_updates_one_post() {
		$this->require_png();

		$source = $this->make_image_attachment();
		$post   = $this->make_post_using( $source );
		$copy   = atme_convert( $source, array( 'format' => 'png' ) );

		$list = new WP_REST_Request( 'GET', '/' . ATME_REST_NAMESPACE . '/references' );
		$list->set_query_params( array( 'from' => $source, 'to' => $copy ) );

		$response = rest_get_server()->dispatch( $list );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $post ), wp_list_pluck( $response->get_data(), 'postId' ) );

		$update = new WP_REST_Request( 'POST', '/' . ATME_REST_NAMESPACE . '/references' );
		$update->set_body_params( array( 'from' => $source, 'to' => $copy, 'post' => $post ) );

		$response = rest_get_server()->dispatch( $update );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['changed'] );
		$this->assertStringContainsString( 'wp-image-' . $copy, get_post_field( 'post_content', $post ) );
	}
}
