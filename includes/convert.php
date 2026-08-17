<?php
/**
 * The conversion engine.
 *
 * One service the REST routes, the abilities and the wizard all call. It
 * never assumes a codec: `atme_conversion_capabilities()` probes what this
 * host's Imagick and GD can actually encode and decode, the UI greys out the
 * rest, and the browser's own WASM codecs pick up formats the server lacks.
 *
 * Non-destructive by default: converting makes a sibling attachment stamped
 * with provenance meta in both directions. Replacing is a separate, explicit
 * verb that lives in `replace.php` and stashes a version first.
 *
 * No Composer, no binaries — the engine is WordPress's own image editors
 * over the PHP extensions the host already has.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

/**
 * The formats this plugin knows how to talk about at all.
 *
 * Keys are the short names the UI and REST use; values are MIME types.
 *
 * @since 0.1.0
 *
 * @return array<string,string> Format slug → MIME type.
 */
function atme_known_formats() {
	return array(
		'jpeg' => 'image/jpeg',
		'png'  => 'image/png',
		'webp' => 'image/webp',
		'avif' => 'image/avif',
		'gif'  => 'image/gif',
	);
}

/**
 * What this host can convert, probed once per request.
 *
 * Asks Imagick for its format list and GD for its feature flags rather than
 * trusting version numbers. `decode` additionally reports the formats worth
 * *importing from* — HEIC from an iPhone, a PDF's first page — which are not
 * offered as targets.
 *
 * @since 0.1.0
 *
 * @return array {
 *     @type bool  $imagick Whether Imagick is loaded.
 *     @type bool  $gd      Whether GD is loaded.
 *     @type array $encode  Format slug → bool, targets the server can write.
 *     @type array $decode  Extra sources the server can read: heic, pdf, svg.
 * }
 */
function atme_conversion_capabilities() {
	static $capabilities = null;

	if ( null !== $capabilities ) {
		return $capabilities;
	}

	$imagick_formats = array();

	if ( extension_loaded( 'imagick' ) && class_exists( 'Imagick' ) ) {
		$imagick_formats = array_map( 'strtoupper', (array) Imagick::queryFormats() );
	}

	$gd = extension_loaded( 'gd' ) && function_exists( 'gd_info' ) ? gd_info() : array();

	$encode = array(
		'jpeg' => in_array( 'JPEG', $imagick_formats, true ) || ! empty( $gd['JPEG Support'] ),
		'png'  => in_array( 'PNG', $imagick_formats, true ) || ! empty( $gd['PNG Support'] ),
		'webp' => in_array( 'WEBP', $imagick_formats, true ) || ! empty( $gd['WebP Support'] ),
		'avif' => in_array( 'AVIF', $imagick_formats, true ) || ! empty( $gd['AVIF Support'] ),
		'gif'  => in_array( 'GIF', $imagick_formats, true ) || ! empty( $gd['GIF Create Support'] ),
	);

	$decode = array(
		'heic' => in_array( 'HEIC', $imagick_formats, true ),
		'pdf'  => in_array( 'PDF', $imagick_formats, true ),
		'svg'  => in_array( 'SVG', $imagick_formats, true ),
	);

	$capabilities = array(
		'imagick' => ! empty( $imagick_formats ),
		'gd'      => ! empty( $gd ),
		'encode'  => $encode,
		'decode'  => $decode,
	);

	/**
	 * Filters the probed conversion capabilities.
	 *
	 * A host that knows better — a proxy that transcodes, a farm with a
	 * dedicated image service — can widen or narrow what the UI offers.
	 *
	 * @since 0.1.0
	 *
	 * @param array $capabilities See {@see atme_conversion_capabilities()}.
	 */
	$capabilities = apply_filters( 'atme_conversion_formats', $capabilities );

	return $capabilities;
}

/**
 * The memory ceiling for a server-side decode, in pixels.
 *
 * A 12,000×12,000 PNG decodes to more than half a gigabyte of bitmap; on a
 * shared host that is the request dying with nothing in the log. Images over
 * the ceiling are refused with a clear error, and the client routes them to
 * the browser codec path instead.
 *
 * @since 0.1.0
 *
 * @return int Maximum source pixel count.
 */
function atme_convert_pixel_ceiling() {
	/**
	 * Filters the largest image, in source pixels, the server will decode.
	 *
	 * @since 0.1.0
	 *
	 * @param int $ceiling Pixel count. Default 64 megapixels.
	 */
	return (int) apply_filters( 'atme_convert_pixel_ceiling', 64 * 1000 * 1000 );
}

/**
 * Converts an attachment into another format, as a new sibling attachment.
 *
 * Reads the *original* file — never a thumbnail — converts it, inserts the
 * result as its own attachment with fresh sub-sizes, and stamps provenance
 * meta both ways so the pair stay navigable.
 *
 * @since 0.1.0
 *
 * @param int   $attachment_id Source attachment.
 * @param array $args {
 *     Conversion arguments.
 *
 *     @type string $format     Target format slug from {@see atme_known_formats()}. Required.
 *     @type int    $quality    1–100. Default 82.
 *     @type bool   $strip_meta Drop EXIF/XMP on the copy. Default false.
 *     @type int    $max_width  Downscale to fit this width, 0 keeps size. Default 0.
 * }
 * @return int|WP_Error New attachment ID, or why not.
 */
function atme_convert( $attachment_id, $args ) {
	$prepared = atme_prepare_conversion( $attachment_id, $args );

	if ( is_wp_error( $prepared ) ) {
		return $prepared;
	}

	list( $source_path, $args ) = $prepared;

	$upload_dir = wp_upload_dir();

	if ( ! empty( $upload_dir['error'] ) ) {
		return new WP_Error( 'atme_uploads_unwritable', $upload_dir['error'] );
	}

	$basename = pathinfo( $source_path, PATHINFO_FILENAME ) . '.' . atme_format_extension( $args['format'] );
	$target   = trailingslashit( $upload_dir['path'] ) . wp_unique_filename( $upload_dir['path'], $basename );

	$written = atme_write_converted_file( $source_path, $target, $args );

	if ( is_wp_error( $written ) ) {
		return $written;
	}

	$formats = atme_known_formats();

	$new_id = wp_insert_attachment(
		array(
			'post_mime_type' => $formats[ $args['format'] ],
			'post_title'     => get_the_title( $attachment_id ),
			'post_content'   => '',
			'post_excerpt'   => (string) get_post_field( 'post_excerpt', $attachment_id ),
			'post_parent'    => (int) get_post_field( 'post_parent', $attachment_id ),
		),
		$target,
		0,
		true
	);

	if ( is_wp_error( $new_id ) ) {
		wp_delete_file( $target );
		return $new_id;
	}

	// Alt text and folders travel with the copy; a converted photo is the
	// same photo.
	$alt = get_post_meta( $attachment_id, '_wp_attachment_image_alt', true );

	if ( '' !== $alt ) {
		update_post_meta( $new_id, '_wp_attachment_image_alt', $alt );
	}

	$folders = wp_get_object_terms( $attachment_id, ATME_FOLDER_TAX, array( 'fields' => 'ids' ) );

	if ( ! is_wp_error( $folders ) && ! empty( $folders ) ) {
		wp_set_object_terms( $new_id, $folders, ATME_FOLDER_TAX );
	}

	require_once ABSPATH . 'wp-admin/includes/image.php';
	wp_update_attachment_metadata( $new_id, wp_generate_attachment_metadata( $new_id, $target ) );

	update_post_meta( $new_id, ATME_META_CONVERTED_FROM, (int) $attachment_id );

	$conversions   = array_filter( (array) get_post_meta( $attachment_id, ATME_META_CONVERSIONS, true ), 'is_numeric' );
	$conversions[] = (int) $new_id;
	update_post_meta( $attachment_id, ATME_META_CONVERSIONS, array_values( array_unique( array_map( 'intval', $conversions ) ) ) );

	atme_record_change( $new_id, 'created' );

	/**
	 * Fires after an attachment has been converted into a new sibling.
	 *
	 * @since 0.1.0
	 *
	 * @param int   $new_id        The new attachment.
	 * @param int   $attachment_id The source attachment.
	 * @param array $args          The conversion arguments used.
	 */
	do_action( 'atme_media_converted', $new_id, $attachment_id, $args );

	return $new_id;
}

/**
 * Converts an attachment in place: same ID, same URL, new format inside.
 *
 * The convert half writes to a staging file; the replace half — with its
 * version stash and sub-size regeneration — is {@see atme_replace()}, so
 * this is undoable like any other replace.
 *
 * @since 0.1.0
 *
 * @param int   $attachment_id Attachment.
 * @param array $args          See {@see atme_convert()}.
 * @return true|WP_Error True on success.
 */
function atme_convert_replace( $attachment_id, $args ) {
	$prepared = atme_prepare_conversion( $attachment_id, $args );

	if ( is_wp_error( $prepared ) ) {
		return $prepared;
	}

	list( $source_path, $args ) = $prepared;

	$upload_dir = wp_upload_dir();

	if ( ! empty( $upload_dir['error'] ) ) {
		return new WP_Error( 'atme_uploads_unwritable', $upload_dir['error'] );
	}

	$staging_name = pathinfo( $source_path, PATHINFO_FILENAME ) . '.' . atme_format_extension( $args['format'] );
	$staging      = trailingslashit( $upload_dir['path'] ) . wp_unique_filename( $upload_dir['path'], $staging_name );

	$written = atme_write_converted_file( $source_path, $staging, $args );

	if ( is_wp_error( $written ) ) {
		return $written;
	}

	$formats = atme_known_formats();

	return atme_replace(
		$attachment_id,
		$staging,
		array(
			'mime'      => $formats[ $args['format'] ],
			// The format changed, so the extension must; the stem survives.
			'keep_name' => true,
		)
	);
}

/**
 * Validates a conversion request and resolves the source file.
 *
 * Shared by convert-as-copy and convert-and-replace so the two verbs cannot
 * drift on what they accept.
 *
 * @since 0.1.0
 *
 * @param int   $attachment_id Source attachment.
 * @param array $args          Raw arguments; see {@see atme_convert()}.
 * @return array|WP_Error `[ $source_path, $normalized_args ]`, or why not.
 */
function atme_prepare_conversion( $attachment_id, $args ) {
	$args = wp_parse_args(
		$args,
		array(
			'format'     => '',
			'quality'    => 82,
			'strip_meta' => false,
			'max_width'  => 0,
			'rotate'     => 0,
		)
	);

	$args['quality']   = max( 1, min( 100, (int) $args['quality'] ) );
	$args['max_width'] = max( 0, (int) $args['max_width'] );
	$args['rotate']    = in_array( (int) $args['rotate'], array( 90, 180, 270 ), true ) ? (int) $args['rotate'] : 0;

	$formats = atme_known_formats();

	if ( ! isset( $formats[ $args['format'] ] ) ) {
		return new WP_Error( 'atme_unknown_format', __( 'That is not a format this plugin can produce.', 'allterrain-media-explorer' ) );
	}

	$capabilities = atme_conversion_capabilities();

	if ( empty( $capabilities['encode'][ $args['format'] ] ) ) {
		return new WP_Error( 'atme_format_unavailable', __( 'This server cannot encode that format. The browser-side converter can.', 'allterrain-media-explorer' ) );
	}

	$post = get_post( $attachment_id );

	if ( ! $post || 'attachment' !== $post->post_type ) {
		return new WP_Error( 'atme_not_an_attachment', __( 'No such media item.', 'allterrain-media-explorer' ) );
	}

	$source_path = atme_original_file_path( $attachment_id );

	if ( ! $source_path ) {
		return new WP_Error( 'atme_file_missing', __( 'The media item exists but its file is gone from disk.', 'allterrain-media-explorer' ) );
	}

	// PDF pages and SVGs have no bitmap header for `wp_getimagesize` to
	// read; when this host's Imagick can rasterize them, they go straight to
	// the raw-Imagick path in `atme_write_converted_file()`.
	$mime         = (string) get_post_mime_type( $attachment_id );
	$capabilities = atme_conversion_capabilities();
	$rasterizable = ( 'application/pdf' === $mime && ! empty( $capabilities['decode']['pdf'] ) )
		|| ( 'image/svg+xml' === $mime && ! empty( $capabilities['decode']['svg'] ) );

	if ( $rasterizable ) {
		return array( $source_path, $args );
	}

	$size = wp_getimagesize( $source_path );

	if ( ! $size ) {
		return new WP_Error( 'atme_not_an_image', __( 'That file is not an image this server can read.', 'allterrain-media-explorer' ) );
	}

	if ( ( $size[0] * $size[1] ) > atme_convert_pixel_ceiling() ) {
		return new WP_Error( 'atme_too_large', __( 'That image is too large to decode on this server. Use the browser-side converter.', 'allterrain-media-explorer' ) );
	}

	return array( $source_path, $args );
}

/**
 * The full-resolution file behind an attachment.
 *
 * `wp_get_original_image_path()` for images WordPress scaled on upload,
 * `get_attached_file()` for everything else. Never a sub-size.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Attachment.
 * @return string Path, or an empty string when the file is gone.
 */
function atme_original_file_path( $attachment_id ) {
	$path = '';

	if ( wp_attachment_is_image( $attachment_id ) ) {
		$path = (string) wp_get_original_image_path( $attachment_id );
	}

	if ( ! $path ) {
		$path = (string) get_attached_file( $attachment_id );
	}

	return $path && file_exists( $path ) ? $path : '';
}

/**
 * The file extension for a target format.
 *
 * @since 0.1.0
 *
 * @param string $format Format slug.
 * @return string Extension without the dot.
 */
function atme_format_extension( $format ) {
	return 'jpeg' === $format ? 'jpg' : $format;
}

/**
 * Encodes one file into another format on disk.
 *
 * `WP_Image_Editor` first — it picks Imagick or GD, honours EXIF rotation and
 * is the code path core itself trusts. Raw Imagick as the fallback for
 * sources core's editors refuse (HEIC, PDF pages) on hosts whose Imagick can
 * read them.
 *
 * @since 0.1.0
 *
 * @param string $source_path Source file.
 * @param string $target_path Destination file; extension decides nothing.
 * @param array  $args        Normalized conversion arguments.
 * @return true|WP_Error True on success.
 */
function atme_write_converted_file( $source_path, $target_path, $args ) {
	$formats = atme_known_formats();
	$mime    = $formats[ $args['format'] ];

	$editor = wp_get_image_editor( $source_path );

	if ( ! is_wp_error( $editor ) ) {
		$editor->set_quality( $args['quality'] );

		if ( ! empty( $args['rotate'] ) ) {
			// WP_Image_Editor rotates counter-clockwise for positive angles;
			// the argument is clockwise, the way every toolbar arrow reads.
			$rotated = $editor->rotate( 360 - (int) $args['rotate'] );

			if ( is_wp_error( $rotated ) ) {
				return $rotated;
			}
		}

		if ( $args['max_width'] > 0 ) {
			$resized = $editor->resize( $args['max_width'], null );

			if ( is_wp_error( $resized ) ) {
				return $resized;
			}
		}

		$saved = $editor->save( $target_path, $mime );

		if ( ! is_wp_error( $saved ) ) {
			if ( $args['strip_meta'] ) {
				atme_strip_image_meta( $saved['path'] );
			}

			return true;
		}
	}

	// Core's editors could not read or write it; raw Imagick may still.
	if ( ! extension_loaded( 'imagick' ) || ! class_exists( 'Imagick' ) ) {
		return is_wp_error( $editor )
			? $editor
			: new WP_Error( 'atme_encode_failed', __( 'This server could not encode the image.', 'allterrain-media-explorer' ) );
	}

	try {
		$image = new Imagick();
		$image->readImage( $source_path . '[0]' );
		$image->autoOrient();

		if ( ! empty( $args['rotate'] ) ) {
			$image->rotateImage( new ImagickPixel( 'none' ), (int) $args['rotate'] );
		}

		if ( $args['max_width'] > 0 && $image->getImageWidth() > $args['max_width'] ) {
			$image->resizeImage( $args['max_width'], 0, Imagick::FILTER_LANCZOS, 1 );
		}

		if ( $args['strip_meta'] ) {
			$image->stripImage();
		}

		$image->setImageFormat( atme_format_extension( $args['format'] ) );
		$image->setImageCompressionQuality( $args['quality'] );
		$image->writeImage( $target_path );
		$image->clear();
	} catch ( Exception $e ) {
		return new WP_Error( 'atme_encode_failed', $e->getMessage() );
	}

	return true;
}

/**
 * Strips EXIF/XMP from an image file in place, when the host can.
 *
 * Best-effort by design: a strip that fails leaves a valid image with its
 * metadata, which is strictly better than no image.
 *
 * @since 0.1.0
 *
 * @param string $path Image file.
 * @return void
 */
function atme_strip_image_meta( $path ) {
	if ( ! extension_loaded( 'imagick' ) || ! class_exists( 'Imagick' ) ) {
		return;
	}

	try {
		$image    = new Imagick( $path );
		$profiles = $image->getImageProfiles( 'icc', true );

		$image->stripImage();

		// Stripping the colour profile shifts colours on wide-gamut photos;
		// EXIF goes, the ICC profile stays.
		if ( ! empty( $profiles['icc'] ) ) {
			$image->profileImage( 'icc', $profiles['icc'] );
		}

		$image->writeImage( $path );
		$image->clear();
	} catch ( Exception $e ) {
		// Left as it was.
		unset( $e );
	}
}

add_filter( 'upload_mimes', 'atme_allow_heic_uploads' );
add_filter( 'wp_handle_upload', 'atme_handle_heic_upload' );

/**
 * Lets iPhone photos into the library, on hosts that can read them.
 *
 * Core rejects HEIC outright. When this server's Imagick can decode it,
 * refusing the format buys nothing but a support thread — so it is allowed,
 * and converted on the way in (below).
 *
 * @since 0.1.0
 *
 * @param array $mimes Allowed MIME types.
 * @return array With HEIC, when decodable here.
 */
function atme_allow_heic_uploads( $mimes ) {
	$capabilities = atme_conversion_capabilities();

	if ( ! empty( $capabilities['decode']['heic'] ) ) {
		$mimes['heic|heif'] = 'image/heic';
	}

	return $mimes;
}

/**
 * Converts a HEIC upload to a web format before it becomes an attachment.
 *
 * On the `wp_handle_upload` filter, so the library only ever holds the
 * converted file — no browser can display HEIC, and a library of thumbnails
 * that never render is worse than a refused upload.
 *
 * @since 0.1.0
 *
 * @param array $upload { file, url, type } from wp_handle_upload().
 * @return array Possibly rewritten to the converted file.
 */
function atme_handle_heic_upload( $upload ) {
	if ( empty( $upload['type'] ) || ! in_array( $upload['type'], array( 'image/heic', 'image/heif' ), true ) ) {
		return $upload;
	}

	$capabilities = atme_conversion_capabilities();

	if ( empty( $capabilities['decode']['heic'] ) || ! extension_loaded( 'imagick' ) ) {
		return $upload;
	}

	/**
	 * Filters the format iPhone photos convert into on upload.
	 *
	 * Return an empty string to keep HEIC files as they are.
	 *
	 * @since 0.1.0
	 *
	 * @param string $format One of {@see atme_known_formats()}. Default `jpeg`.
	 */
	$format = (string) apply_filters( 'atme_heic_upload_format', 'jpeg' );

	$formats = atme_known_formats();

	if ( '' === $format || ! isset( $formats[ $format ] ) || empty( $capabilities['encode'][ $format ] ) ) {
		return $upload;
	}

	$target = preg_replace( '/\.[a-z0-9]+$/i', '', $upload['file'] ) . '.' . atme_format_extension( $format );

	$written = atme_write_converted_file(
		$upload['file'],
		$target,
		array(
			'format'     => $format,
			'quality'    => 90,
			'strip_meta' => false,
			'max_width'  => 0,
		)
	);

	if ( is_wp_error( $written ) ) {
		// The original still uploads; it just stays HEIC.
		return $upload;
	}

	wp_delete_file( $upload['file'] );

	$upload['file'] = $target;
	$upload['url']  = preg_replace( '/\.[a-z0-9]+$/i', '', $upload['url'] ) . '.' . atme_format_extension( $format );
	$upload['type'] = $formats[ $format ];

	return $upload;
}
