<?php
/**
 * Plugin Name:       AllTerrain MAIA — Media Asset Interface & Administration
 * Plugin URI:        https://github.com/AllTerrainDeveloper/MAIA-Media-Asset-Interface-Administration
 * Description:       Organize, view and optimize your WordPress media in OpenStation. Folders, collections, format conversion and restorable versions.
 * Version:           0.1.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Daniel Lopez
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       allterrain-maia
 *
 * AllTerrain MAIA is a media library built as an OpenStation application.
 * The distribution slug and text domain are `allterrain-maia`. The bootstrap
 * filename, `atme_` prefixes, REST namespace and window IDs retain their
 * original spellings to preserve saved data, session restore and integrations.
 *
 * Three decisions shape the whole plugin:
 *
 * **An attachment is already a post.** This plugin registers no bespoke tables
 * and no shadow copies of the library. Folders are a taxonomy on `attachment`,
 * collections are saved-query posts, versions are attachment meta pointing at
 * real files. Core REST (`/wp/v2/media`) does the browsing; the plugin's own
 * namespace adds only what core cannot say in one round trip.
 *
 * **OpenStation is required.** The explorer is a native window — rendered into
 * the shell's own DOM, which is what gives it OpenStation's components, its
 * drag manager and its window chrome. A photo lifting out of the grid and
 * landing in a Gutenberg post, on a kanban card, or in a wallpaper folder is
 * the shell's pointer pipeline, and none of it exists without the shell. The
 * slug in `Requires Plugins` is `desktop-mode` rather than `openstation`
 * because the header matches on the dependency's *directory* slug, and
 * OpenStation ships from a directory named after what it used to be called.
 * Every shell call still sits behind a `function_exists()` gate resolved
 * through `includes/shell-api.php`: a declared dependency is not a present
 * one, and the gates turn a missing shell into an admin notice instead of a
 * fatal error. Core's own Media Library is untouched either way.
 *
 * **Nothing destroys pixels without a copy of the old ones.** Convert makes a
 * sibling unless asked to replace; replace stashes a version you can roll
 * back; the wizard never deletes on its own.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

define( 'ATME_VERSION', '0.1.1' );
define( 'ATME_FILE', __FILE__ );
define( 'ATME_DIR', plugin_dir_path( __FILE__ ) );
define( 'ATME_URL', plugin_dir_url( __FILE__ ) );

/**
 * REST namespace for what core REST cannot express in one round trip:
 * converting a file, replacing one in place, scanning the library, resolving
 * usage before a delete.
 */
define( 'ATME_REST_NAMESPACE', 'atme/v1' );

/**
 * The folder taxonomy on `attachment`.
 *
 * Folders are labels, not locations: hierarchical, and a file can carry two of
 * them. That is a taxonomy's exact shape, and registering it `show_in_rest`
 * makes `/wp/v2/media?atme_folder=…` filtering free.
 */
define( 'ATME_FOLDER_TAX', 'atme_folder' );

/**
 * The collection post type: a saved search.
 *
 * Named `atme-collection` well under WordPress's 20-character post type cap.
 * The query it stands for is JSON in one meta row, so a collection is
 * shareable, exportable and trashable like anything else.
 */
define( 'ATME_COLLECTION_TYPE', 'atme-collection' );

/**
 * Post meta keys on an attachment.
 *
 * Registered with `register_post_meta( … 'show_in_rest' => true )` where they
 * are part of the public surface.
 */
define( 'ATME_META_VERSIONS', '_atme_versions' );
define( 'ATME_META_CONVERTED_FROM', '_atme_converted_from' );
define( 'ATME_META_CONVERSIONS', '_atme_conversions' );
define( 'ATME_META_HASH', '_atme_hash' );

/** Meta key on a collection holding its saved query as JSON. */
define( 'ATME_META_QUERY', '_atme_query' );

/** Option holding the wizard's resumable batch state. */
define( 'ATME_OPTION_WIZARD', 'atme_wizard_state' );

require_once ATME_DIR . 'includes/shell-api.php';
require_once ATME_DIR . 'includes/content-model.php';
require_once ATME_DIR . 'includes/helpers.php';
require_once ATME_DIR . 'includes/convert.php';
require_once ATME_DIR . 'includes/replace.php';
require_once ATME_DIR . 'includes/usage.php';
require_once ATME_DIR . 'includes/folders.php';
require_once ATME_DIR . 'includes/wizard.php';
require_once ATME_DIR . 'includes/rest.php';
require_once ATME_DIR . 'includes/abilities.php';
require_once ATME_DIR . 'includes/assets.php';
require_once ATME_DIR . 'includes/admin-page.php';
require_once ATME_DIR . 'includes/explorer.php';
require_once ATME_DIR . 'includes/window.php';
require_once ATME_DIR . 'includes/apps.php';

register_activation_hook( __FILE__, 'atme_activate' );

/**
 * Prepares a site to organize its media.
 *
 * Registers the content model before flushing, because rewrite rules for an
 * unregistered taxonomy are rules for nothing.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atme_activate() {
	atme_register_content_model();
	flush_rewrite_rules();
}

register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );
