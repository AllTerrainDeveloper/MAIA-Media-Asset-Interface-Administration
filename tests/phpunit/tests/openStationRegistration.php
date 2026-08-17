<?php
/**
 * The contract with the shell, asserted against the bootstrap's stubs.
 *
 * @package AllTerrain_Media_Explorer
 */

/**
 * What the plugin registers with OpenStation.
 *
 * @group allterrain-media-explorer
 */
class Tests_ATME_OpenStation_Registration extends WP_UnitTestCase {

	/**
	 * Runs the registration as an admin, the way the shell would.
	 */
	private function register_as_admin() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$GLOBALS['atme_shell_registrations']['window']  = array();
		$GLOBALS['atme_shell_registrations']['icon']    = array();
		$GLOBALS['atme_shell_registrations']['opener']  = array();
		$GLOBALS['atme_shell_registrations']['command'] = array();

		atme_register_shell_surfaces();
	}

	/**
	 * @covers ::atme_register_shell_surfaces
	 */
	public function test_the_explorer_registers_as_a_native_window() {
		$this->register_as_admin();

		$windows = $GLOBALS['atme_shell_registrations']['window'];

		$this->assertArrayHasKey( 'allterrain-media-explorer', $windows );

		$window = $windows['allterrain-media-explorer'];

		$this->assertSame( 'atme_render_window_template', $window['template'] );
		$this->assertSame( 'allterrain-media-explorer', $window['script'] );
		$this->assertSame( 'allterrain-media-explorer', $window['style'] );
		$this->assertSame( 'dock', $window['placement'] );
		$this->assertSame( array( 'upload_files' ), $window['capabilities'] );
	}

	/**
	 * @covers ::atme_register_shell_surfaces
	 */
	public function test_the_window_cannot_shrink_below_a_usable_grid() {
		$this->register_as_admin();

		$window = $GLOBALS['atme_shell_registrations']['window']['allterrain-media-explorer'];

		$this->assertGreaterThanOrEqual( 640, $window['min_width'] );
		$this->assertGreaterThanOrEqual( 400, $window['min_height'] );
	}

	/**
	 * @covers ::atme_register_shell_surfaces
	 */
	public function test_a_wallpaper_icon_points_at_the_window() {
		$this->register_as_admin();

		$icons = $GLOBALS['atme_shell_registrations']['icon'];

		$this->assertArrayHasKey( 'allterrain-media-explorer', $icons );
		$this->assertSame( 'allterrain-media-explorer', $icons['allterrain-media-explorer']['window'] );
	}

	/**
	 * @covers ::atme_register_shell_surfaces
	 */
	public function test_the_viewer_registers_as_its_own_window_without_a_dock_tile() {
		$this->register_as_admin();

		$windows = $GLOBALS['atme_shell_registrations']['window'];

		$this->assertArrayHasKey( 'atme-viewer', $windows );

		$viewer = $windows['atme-viewer'];

		$this->assertSame( 'atme_render_viewer_template', $viewer['template'] );
		$this->assertSame( 'allterrain-media-explorer', $viewer['script'] );
		$this->assertSame( 'none', $viewer['placement'] );
		$this->assertSame( array( 'upload_files' ), $viewer['capabilities'] );
	}

	/**
	 * @covers ::atme_render_viewer_template
	 */
	public function test_the_viewer_template_paints_a_root() {
		ob_start();
		atme_render_viewer_template();
		$html = ob_get_clean();

		$this->assertStringContainsString( 'data-atme-viewer-root', $html );
	}

	/**
	 * @covers ::atme_register_shell_surfaces
	 */
	public function test_the_viewer_is_the_one_and_only_opener_this_plugin_registers() {
		$this->register_as_admin();

		$openers = $GLOBALS['atme_shell_registrations']['opener'];

		$this->assertArrayHasKey( 'atme-viewer', $openers );
		$this->assertSame( array( 'attachment' ), $openers['atme-viewer']['types'] );
		// Deliberately not default-flagged: "(default)" in Preferences marks
		// the opener WordPress ships. MAIA becomes the effective opener via
		// the seeded user association in the shell bundle instead.
		$this->assertFalse( $openers['atme-viewer']['is_default'] );
		$this->assertSame( 'allterrain-media-explorer-shell', $openers['atme-viewer']['script'] );

		// One opener row, deliberately: "reveal in library" lives in the
		// viewer's toolbar instead of cluttering File Associations.
		$this->assertArrayNotHasKey( 'allterrain-media-explorer', $openers );
	}

	/**
	 * @covers ::atme_register_shell_surfaces
	 */
	public function test_both_commands_reach_the_palette() {
		$this->register_as_admin();

		$slugs = wp_list_pluck( $GLOBALS['atme_shell_registrations']['command'], 'slug' );

		$this->assertContains( 'allterrain-media-explorer', $slugs );
		$this->assertContains( 'allterrain-media-explorer-wizard', $slugs );
	}

	/**
	 * @covers ::atme_render_window_template
	 */
	public function test_the_template_paints_a_frame_and_a_loading_state() {
		ob_start();
		atme_render_window_template();
		$html = ob_get_clean();

		$this->assertStringContainsString( 'data-atme-root', $html );
		$this->assertStringContainsString( 'data-atme-loading', $html );
		$this->assertStringContainsString( 'data-atme-sidebar', $html );
		$this->assertStringContainsString( 'data-atme-main', $html );
		$this->assertStringContainsString( 'data-atme-inspector', $html );
	}

	/**
	 * @covers ::atme_script_config
	 */
	public function test_every_bundle_depends_on_the_config_it_reads() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		atme_register_assets();

		foreach ( array( 'allterrain-media-explorer', 'allterrain-media-explorer-shell' ) as $handle ) {
			$script = wp_scripts()->registered[ $handle ];

			$this->assertContains( 'allterrain-media-explorer-config', $script->deps );
		}

		$config = atme_script_config();

		$this->assertArrayHasKey( 'restUrl', $config );
		$this->assertArrayHasKey( 'wpRestUrl', $config );
		$this->assertArrayHasKey( 'nonce', $config );
		$this->assertArrayHasKey( 'conversion', $config );
		$this->assertArrayHasKey( 'folderField', $config );
	}
}
