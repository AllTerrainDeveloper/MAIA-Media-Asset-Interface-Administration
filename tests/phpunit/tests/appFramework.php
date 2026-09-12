<?php
/** App definitions tested against OpenStation's actual host-independent runtime.
 * @package AllTerrain_Media_Explorer
 */
defined( 'ABSPATH' ) || exit;

/** @group allterrain-media-explorer */
class Tests_ATME_App_Framework extends WP_UnitTestCase {
	public function set_up() {
		parent::set_up();
		$autoload = getenv( 'ATME_FRAMEWORK_AUTOLOAD' ) ?: WP_PLUGIN_DIR . '/desktop-mode/includes/framework/autoload.php';
		if ( ! file_exists( $autoload ) ) {
			$autoload = ATME_DIR . '.test-framework/includes/framework/autoload.php';
		}
		if ( ! class_exists( 'OpenStation\App' ) && ! file_exists( $autoload ) ) {
			$this->markTestSkipped( 'Set ATME_FRAMEWORK_AUTOLOAD to the OpenStation framework autoloader.' );
		}
		if ( ! class_exists( 'OpenStation\App' ) ) {
			require_once $autoload;
		}
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	/** @covers ::atme_app_retarget */
	public function test_both_apps_mount_reopen_and_gate_with_the_real_runtime() {
		$registry = new OpenStation\App\Registry();
		$registry->load_dir( ATME_DIR . 'apps' );
		$runtime = new OpenStation\App\Runtime( $registry );
		$os = OpenStation\App\Os::standalone( array( 'auth' => new OpenStation\App\WordPress\Auth() ) );
		$first = self::factory()->attachment->create();
		$second = self::factory()->attachment->create();
		foreach ( array( 'allterrain-media-explorer', 'atme-viewer' ) as $id ) {
			$app = $registry->get( $id );
			$this->assertNotNull( $app );
			$this->assertFileExists( $app->manifest()['client'] );
			$result = $runtime->dispatch( $id, array( 'action' => 'mount', 'params' => array( 'mediaId' => $first ) ), $os );
			$this->assertTrue( $result['ok'] );
			$this->assertSame( $first, $result['state']['mediaId'] );
			$next = $runtime->dispatch( $id, array( 'action' => 'reopen', 'state' => $result['state'], 'params' => array( 'mediaId' => $second ) ), $os );
			$this->assertTrue( $next['ok'] );
			$this->assertSame( $second, $next['state']['mediaId'] );
			$this->assertGreaterThan( $result['state']['revision'], $next['state']['revision'] );
			$bad = $runtime->dispatch( $id, array( 'action' => 'reopen', 'params' => array( 'mediaId' => array( $first ), 'wizard' => 'false' ) ), $os );
			$this->assertSame( 0, $bad['state']['mediaId'] );
			$this->assertFalse( $bad['state']['wizard'] );
			wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
			$this->assertSame( 403, $runtime->dispatch( $id, array( 'action' => 'mount' ), $os )['status'] );
			wp_set_current_user( 0 );
			$this->assertFalse( $app->allows( $os ) );
			wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		}
	}

	/** @covers ::atme_app_window_args */
	public function test_framework_registration_preserves_dependencies_and_window_filters() {
		$args = array( 'script' => 'openstation-app-runtime', 'scripts' => array( 'client' ), 'width' => 1280 );
		$filter = static function ( $window ) { $window['width'] = 900; return $window; };
		add_filter( 'atme_window_args', $filter );
		$actual = atme_app_window_args( $args, 'allterrain-media-explorer' );
		remove_filter( 'atme_window_args', $filter );
		$this->assertSame( 900, $actual['width'] );
		$this->assertSame( array( 'allterrain-media-explorer-config', 'client' ), $actual['scripts'] );
		$this->assertSame( 'openstation-app-runtime', $actual['script'] );
		$this->assertSame( $args, atme_app_window_args( $args, 'another-app' ) );
	}
}
