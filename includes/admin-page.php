<?php
/**
 * The admin page, which is a signpost rather than a product.
 *
 * The explorer is native-only: its grid, its drag surface and its wizard
 * exist inside the OpenStation shell. This page exists so a user who lands
 * on **Media → Media Explorer** with the desktop switched off is told where
 * the product actually lives and how to switch it on, instead of finding a
 * dead menu item — and so a second, lesser explorer never grows here and
 * rots.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

add_action( 'admin_menu', 'atme_register_admin_page' );

/**
 * Hangs the signpost under Media.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_register_admin_page() {
	add_media_page(
		__( 'MAIA', 'allterrain-media-explorer' ),
		__( 'MAIA', 'allterrain-media-explorer' ),
		'upload_files',
		'allterrain-media-explorer',
		'atme_render_admin_page'
	);
}

/**
 * Renders the signpost.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_render_admin_page() {
	$has_shell = atme_shell_has( 'register_window' );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'MAIA', 'allterrain-media-explorer' ); ?></h1>
		<?php if ( ! $has_shell ) : ?>
			<p><?php esc_html_e( 'MAIA is an OpenStation desktop app, and OpenStation is not active on this site. Install and activate it, and MAIA will be waiting in the dock.', 'allterrain-media-explorer' ); ?></p>
		<?php elseif ( ! atme_shell_is_active() ) : ?>
			<p><?php esc_html_e( 'MAIA lives on the OpenStation desktop, and the desktop is currently switched off for your account. Switch it on from the toggle in the admin bar and open MAIA from the dock.', 'allterrain-media-explorer' ); ?></p>
		<?php else : ?>
			<p><?php esc_html_e( 'MAIA is open for business on your desktop — look for it in the dock.', 'allterrain-media-explorer' ); ?></p>
		<?php endif; ?>
		<p>
			<a class="button button-secondary" href="<?php echo esc_url( admin_url( 'upload.php' ) ); ?>">
				<?php esc_html_e( 'Open the classic Media Library', 'allterrain-media-explorer' ); ?>
			</a>
		</p>
	</div>
	<?php
}
