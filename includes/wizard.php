<?php
/**
 * The optimization wizard's server half: the scan.
 *
 * The wizard is a client-driven loop — the window asks for the library one
 * chunk at a time, tallies findings, shows the plan, and then applies the
 * chosen remedies through the ordinary convert/replace/alt endpoints. The
 * server's job is to answer one chunk quickly and honestly; it never mutates
 * anything during a scan.
 *
 * Chunked rather than one big pass because a scan hashes files and reads
 * image headers — on a big library that is minutes of I/O, and a request
 * that dies at item 4,000 of 5,000 with nothing to show. A chunk is
 * seconds, resumable, and paints a progress bar honestly.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

/**
 * The width past which the wizard calls an image oversized.
 *
 * @since 0.1.0
 *
 * @return int Pixels.
 */
function atme_wizard_oversize_width() {
	/**
	 * Filters the width past which the wizard flags an image as oversized.
	 *
	 * Default 2560 — WordPress's own "big image" threshold, the width core
	 * already considers larger than any front end needs.
	 *
	 * @since 0.1.0
	 *
	 * @param int $width Pixels.
	 */
	return (int) apply_filters( 'atme_wizard_oversize_width', 2560 );
}

/**
 * Scans one chunk of the library.
 *
 * @since 0.1.0
 *
 * @param int $offset Items to skip.
 * @param int $limit  Items to inspect this chunk.
 * @return array {
 *     @type int     $total    Library size, so the client can draw progress.
 *     @type int     $next     Offset for the next chunk, or -1 when done.
 *     @type array[] $findings One row per finding this chunk: {id, title, kind, detail}.
 * }
 */
function atme_wizard_scan_chunk( $offset, $limit ) {
	$offset = max( 0, (int) $offset );
	$limit  = max( 1, min( 50, (int) $limit ) );

	$query = new WP_Query(
		array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'posts_per_page' => $limit,
			'offset'         => $offset,
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'no_found_rows'  => false,
		)
	);

	$total    = (int) $query->found_posts;
	$findings = array();
	$oversize = atme_wizard_oversize_width();
	$encode   = atme_conversion_capabilities()['encode'];
	$modern   = ! empty( $encode['webp'] ) || ! empty( $encode['avif'] );

	foreach ( $query->posts as $post ) {
		$id    = (int) $post->ID;
		$mime  = (string) $post->post_mime_type;
		$title = get_the_title( $id );

		if ( 0 !== strpos( $mime, 'image/' ) ) {
			continue;
		}

		$facts = atme_file_facts( $id );

		if ( ! $facts['exists'] ) {
			$findings[] = array(
				'id'     => $id,
				'title'  => $title,
				'kind'   => 'missing-file',
				'detail' => '',
			);
			continue;
		}

		if ( $facts['width'] > $oversize ) {
			$findings[] = array(
				'id'     => $id,
				'title'  => $title,
				'kind'   => 'oversized',
				'mime'   => $mime,
				'detail' => $facts['width'] . '×' . $facts['height'] . ' · ' . size_format( $facts['bytes'] ),
			);
		}

		if ( $modern && in_array( $mime, array( 'image/jpeg', 'image/png' ), true )
			&& empty( get_post_meta( $id, ATME_META_CONVERSIONS, true ) ) ) {
			$findings[] = array(
				'id'     => $id,
				'title'  => $title,
				'kind'   => 'legacy-format',
				'detail' => $mime . ' · ' . size_format( $facts['bytes'] ),
			);
		}

		if ( '' === trim( (string) get_post_meta( $id, '_wp_attachment_image_alt', true ) ) ) {
			$findings[] = array(
				'id'     => $id,
				'title'  => $title,
				'kind'   => 'missing-alt',
				'detail' => '',
			);
		}

		// Hashing here is the point of chunking: the duplicates view later is
		// an indexed meta lookup instead of an hour of file I/O.
		$hash = atme_file_hash( $id );

		if ( '' !== $hash ) {
			$findings = array_merge( $findings, atme_wizard_duplicate_findings( $id, $title, $hash ) );
		}
	}

	$next = ( $offset + $limit ) < $total ? $offset + $limit : -1;

	return array(
		'total'    => $total,
		'next'     => $next,
		/**
		 * Filters one scan chunk's findings.
		 *
		 * The seam for a plugin to add its own finding kinds — broken EXIF,
		 * missing captions, a house style rule.
		 *
		 * @since 0.1.0
		 *
		 * @param array[] $findings This chunk's findings.
		 * @param int     $offset   The chunk's offset.
		 */
		'findings' => apply_filters( 'atme_wizard_findings', $findings, $offset ),
	);
}

/**
 * Duplicate rows for one freshly hashed file.
 *
 * Reported on the *later* item of a pair, so a scan sweeping the library in
 * ID order reports each duplicate group exactly once.
 *
 * @since 0.1.0
 *
 * @param int    $id    The attachment just hashed.
 * @param string $title Its title.
 * @param string $hash  Its digest.
 * @return array[] Zero or one finding rows.
 */
function atme_wizard_duplicate_findings( $id, $title, $hash ) {
	$twins = get_posts(
		array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'posts_per_page' => 5,
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'exclude'        => array( $id ),
			'meta_key'       => ATME_META_HASH, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			'meta_value'     => $hash, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
		)
	);

	$earlier = array_filter( array_map( 'intval', $twins ), static function ( $twin ) use ( $id ) {
		return $twin < $id;
	} );

	if ( empty( $earlier ) ) {
		return array();
	}

	return array(
		array(
			'id'     => $id,
			'title'  => $title,
			'kind'   => 'duplicate',
			'detail' => implode( ',', $earlier ),
		),
	);
}

/**
 * Persists the wizard's resumable state.
 *
 * One option, one user at a time: the wizard is an administrative sweep, and
 * two concurrent sweeps converting the same files would trip over each other.
 *
 * @since 0.1.0
 *
 * @param array|null $state State to keep, or null to clear it.
 * @return void
 */
function atme_wizard_save_state( $state ) {
	if ( null === $state ) {
		delete_option( ATME_OPTION_WIZARD );
		return;
	}

	update_option( ATME_OPTION_WIZARD, $state, false );
}

/**
 * The wizard's saved state, if a sweep is mid-flight.
 *
 * @since 0.1.0
 *
 * @return array|null State, or null when none.
 */
function atme_wizard_state() {
	$state = get_option( ATME_OPTION_WIZARD, null );

	return is_array( $state ) ? $state : null;
}
