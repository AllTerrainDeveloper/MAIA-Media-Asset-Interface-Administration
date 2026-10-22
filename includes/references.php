<?php
/**
 * Pointing posts at a converted file.
 *
 * Converting changes a URL either way: a copy is a new attachment with its
 * own ID and files, and converting in place keeps the ID but swaps the
 * extension. Every post that embedded the old file still names the old one.
 * This is the follow-through — find those posts, then rewrite one post at a
 * time so the UI can show each one land.
 *
 * Every rewrite goes through `wp_update_post()`, so a post that keeps
 * revisions gets one, and an update is undone the way any edit is.
 *
 * @package AllTerrain_Media_Explorer
 */

defined( 'ABSPATH' ) || exit;

/**
 * How many earlier URL maps an attachment remembers.
 *
 * One per replace. Two in-place conversions in a row without updating posts
 * in between leave posts pointing at the first URLs; remembering a few lets
 * the next update rewrite all of them to the current file.
 *
 * @since 1.0.0
 *
 * @return int Cap.
 */
function atme_previous_urls_cap() {
	/**
	 * Filters how many earlier URL maps an attachment keeps.
	 *
	 * @since 1.0.0
	 *
	 * @param int $cap Default 10.
	 */
	return max( 1, (int) apply_filters( 'atme_previous_urls_cap', 10 ) );
}

/**
 * Every URL an attachment's files answer at, keyed by size name.
 *
 * `full` is what core calls the attachment URL (the `-scaled` copy when core
 * scaled the upload), `original` the untouched upload when it differs, and
 * every registered sub-size by its own name.
 *
 * @since 1.0.0
 *
 * @param int $attachment_id Attachment.
 * @return array<string,string> Size name → URL. Empty when there is no file.
 */
function atme_attachment_url_map( $attachment_id ) {
	$full = (string) wp_get_attachment_url( $attachment_id );

	if ( '' === $full ) {
		return array();
	}

	$map  = array( 'full' => $full );
	$base = trailingslashit( dirname( $full ) );

	if ( wp_attachment_is_image( $attachment_id ) ) {
		$original = (string) wp_get_original_image_url( $attachment_id );

		if ( $original && $original !== $full ) {
			$map['original'] = $original;
		}
	}

	$metadata = wp_get_attachment_metadata( $attachment_id );

	if ( ! empty( $metadata['sizes'] ) && is_array( $metadata['sizes'] ) ) {
		foreach ( $metadata['sizes'] as $size => $data ) {
			if ( ! empty( $data['file'] ) ) {
				$map[ (string) $size ] = $base . $data['file'];
			}
		}
	}

	return $map;
}

/**
 * Remembers the URLs an attachment answers at, before its files change.
 *
 * Called by {@see atme_replace()} ahead of the swap, because afterwards the
 * old sub-size names are gone from the metadata and there is nothing left to
 * say what posts used to point at.
 *
 * @since 1.0.0
 *
 * @param int $attachment_id Attachment.
 * @return void
 */
function atme_remember_previous_urls( $attachment_id ) {
	$map = atme_attachment_url_map( $attachment_id );

	if ( empty( $map ) ) {
		return;
	}

	$maps = atme_previous_url_maps( $attachment_id );

	// A same-format replace keeps every URL; one copy of that map is enough.
	if ( ! empty( $maps ) && end( $maps ) === $map ) {
		return;
	}

	$maps[] = $map;
	$maps   = array_slice( $maps, - atme_previous_urls_cap() );

	update_post_meta( $attachment_id, ATME_META_PREVIOUS_URLS, $maps );
}

/**
 * The URL maps an attachment answered at before its replacements.
 *
 * @since 1.0.0
 *
 * @param int $attachment_id Attachment.
 * @return array[] Size → URL maps, oldest first.
 */
function atme_previous_url_maps( $attachment_id ) {
	$raw = get_post_meta( $attachment_id, ATME_META_PREVIOUS_URLS, true );

	return array_values( array_filter( (array) $raw, 'is_array' ) );
}

/**
 * Whether two attachments are a conversion pair this flow may rewrite.
 *
 * The same attachment (converted in place), or a copy whose provenance meta
 * names the source. Anything else is a swap between unrelated files, which
 * is not what this verb is for.
 *
 * @since 1.0.0
 *
 * @param int $from The attachment posts use now.
 * @param int $to   The attachment they should use.
 * @return true|WP_Error True when the pair is valid.
 */
function atme_validate_reference_pair( $from, $to ) {
	$from = (int) $from;
	$to   = (int) $to;

	if ( 'attachment' !== get_post_type( $from ) || 'attachment' !== get_post_type( $to ) ) {
		return new WP_Error( 'atme_not_an_attachment', __( 'No such media item.', 'allterrain-maia' ), array( 'status' => 404 ) );
	}

	if ( $from !== $to && (int) get_post_meta( $to, ATME_META_CONVERTED_FROM, true ) !== $from ) {
		return new WP_Error(
			'atme_not_a_conversion',
			__( 'Posts can only be pointed at a converted copy of the file they use.', 'allterrain-maia' ),
			array( 'status' => 400 )
		);
	}

	return true;
}

/**
 * Old URL → new URL, for every spelling a post might contain.
 *
 * Size names line up: the old `medium` becomes the new `medium`, and a size
 * the new file lacks falls back to its `full` URL. For an in-place
 * conversion the old URLs come from the remembered maps, newest first; for a
 * copy, from the source attachment as it stands.
 *
 * Longest URL first, so a full URL can never clip the front off a sub-size.
 *
 * @since 1.0.0
 *
 * @param int $from The attachment posts use now.
 * @param int $to   The attachment they should use.
 * @return array<string,string> Old URL → new URL.
 */
function atme_reference_url_pairs( $from, $to ) {
	$from = (int) $from;
	$to   = (int) $to;
	$new  = atme_attachment_url_map( $to );

	if ( empty( $new ) ) {
		return array();
	}

	$old_maps = $from === $to
		? array_reverse( atme_previous_url_maps( $to ) )
		: array( atme_attachment_url_map( $from ) );

	$current = array_flip( $new );
	$pairs   = array();

	foreach ( $old_maps as $map ) {
		foreach ( $map as $size => $url ) {
			$url    = (string) $url;
			$target = $new[ $size ] ?? $new['full'];

			// A URL the attachment still answers at is not stale; the
			// newest remembered map wins a URL two maps both name.
			if ( '' === $url || isset( $current[ $url ] ) || isset( $pairs[ $url ] ) ) {
				continue;
			}

			$pairs[ $url ] = $target;
		}
	}

	uksort(
		$pairs,
		static function ( $a, $b ) {
			return strlen( $b ) - strlen( $a );
		}
	);

	/**
	 * Filters the URL rewrites applied when posts move to a converted file.
	 *
	 * A CDN that serves media from another host adds its own spellings here.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,string> $pairs Old URL → new URL, longest first.
	 * @param int                  $from  The attachment posts use now.
	 * @param int                  $to    The attachment they should use.
	 */
	return (array) apply_filters( 'atme_reference_url_pairs', $pairs, $from, $to );
}

/**
 * Rewrites one post's content from one attachment to another.
 *
 * URLs by the pair map. For a copy, the ID too, in the places core's own
 * markup carries it: the `wp-image-{id}` class, block attributes (`id`,
 * `mediaId`, a gallery's `ids`), a gallery image's `data-id`, and the
 * `[gallery ids=""]` shortcode.
 *
 * @since 1.0.0
 *
 * @param string $content Post content.
 * @param int    $from    The attachment the content uses now.
 * @param int    $to      The attachment it should use.
 * @param array  $pairs   Old URL → new URL, from {@see atme_reference_url_pairs()}.
 * @return array { 0: string rewritten content, 1: int references changed }
 */
function atme_rewrite_content_references( $content, $from, $to, $pairs ) {
	$from  = (int) $from;
	$to    = (int) $to;
	$count = 0;

	if ( ! empty( $pairs ) ) {
		$content = str_replace( array_keys( $pairs ), array_values( $pairs ), $content, $replaced );
		$count  += $replaced;
	}

	if ( $from === $to ) {
		return array( $content, $count );
	}

	// `\b` keeps wp-image-12 from matching inside wp-image-123.
	$content = preg_replace( '/\bwp-image-' . $from . '\b/', 'wp-image-' . $to, $content, -1, $replaced );
	$count  += $replaced;

	$content = preg_replace( '/\bdata-id="' . $from . '"/', 'data-id="' . $to . '"', $content, -1, $replaced );
	$count  += $replaced;

	$swap_list = static function ( $list ) use ( $from, $to, &$count ) {
		return preg_replace_callback(
			'/(?<![0-9])' . $from . '(?![0-9])/',
			static function () use ( $to, &$count ) {
				++$count;
				return (string) $to;
			},
			$list
		);
	};

	// Block delimiters: only the attribute JSON, never the markup between.
	$content = preg_replace_callback(
		'/<!--\s+wp:[a-z][a-z0-9_\/-]*\s+(\{.*?\})\s+\/?-->/s',
		static function ( $match ) use ( $from, $to, $swap_list, &$count ) {
			$attrs = preg_replace( '/"(id|mediaId)":' . $from . '(?=[,}])/', '"$1":' . $to, $match[1], -1, $replaced );
			$count += $replaced;

			$attrs = preg_replace_callback(
				'/"ids":\[([0-9,\s]*)\]/',
				static function ( $ids ) use ( $swap_list ) {
					return '"ids":[' . $swap_list( $ids[1] ) . ']';
				},
				$attrs
			);

			return str_replace( $match[1], $attrs, $match[0] );
		},
		$content
	);

	$content = preg_replace_callback(
		'/(\[gallery\b[^\]]*\bids=")([0-9,\s]*)(")/',
		static function ( $match ) use ( $swap_list ) {
			return $match[1] . $swap_list( $match[2] ) . $match[3];
		},
		$content
	);

	return array( $content, $count );
}

/**
 * The posts that should move to the converted file.
 *
 * The usage scan of the file posts use now, narrowed to posts (site settings
 * store an ID that keeps working) and to what the current user may edit. An
 * in-place conversion also searches for its remembered filename stems, in
 * case the new file landed under a different name.
 *
 * @since 1.0.0
 *
 * @param int $from The attachment posts use now.
 * @param int $to   The attachment they should use.
 * @return array[] Usage rows, see {@see atme_usage_row()}.
 */
function atme_reference_candidates( $from, $to ) {
	global $wpdb;

	$from = (int) $from;
	$to   = (int) $to;
	$rows = array();
	$seen = array();

	foreach ( atme_media_usage( $from ) as $row ) {
		$post_id = (int) ( $row['postId'] ?? 0 );

		if ( $post_id > 0 && ! isset( $seen[ $post_id ] ) ) {
			$rows[]           = $row;
			$seen[ $post_id ] = true;
		}
	}

	if ( $from === $to ) {
		$current_url  = (string) wp_get_attachment_url( $to );
		$current_stem = preg_replace( '/\.[a-z0-9]+$/i', '', wp_basename( $current_url ) );
		$stems        = array();

		foreach ( atme_previous_url_maps( $to ) as $map ) {
			$stem = preg_replace( '/\.[a-z0-9]+$/i', '', wp_basename( (string) ( $map['full'] ?? '' ) ) );

			if ( $stem && $stem !== $current_stem ) {
				$stems[ $stem ] = true;
			}
		}

		foreach ( array_keys( $stems ) as $stem ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$ids = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT ID FROM {$wpdb->posts} WHERE post_type NOT IN ( 'revision', 'attachment' ) AND post_status NOT IN ( 'trash', 'auto-draft' ) AND post_content LIKE %s LIMIT 100",
					'%' . $wpdb->esc_like( $stem ) . '%'
				)
			);

			foreach ( array_map( 'intval', $ids ) as $post_id ) {
				if ( ! isset( $seen[ $post_id ] ) && current_user_can( 'edit_post', $post_id ) ) {
					$rows[]           = atme_usage_row( $post_id, 'content' );
					$seen[ $post_id ] = true;
				}
			}
		}
	}

	// Only what an update would actually change. A post whose only use is
	// a featured image keeps working through an in-place conversion, since
	// the ID it stores never moved; offering it would be a prompt for nothing.
	$pairs = atme_reference_url_pairs( $from, $to );
	$rows  = array_values(
		array_filter(
			$rows,
			static function ( $row ) use ( $from, $to, $pairs ) {
				return atme_post_needs_reference_update( (int) $row['postId'], $from, $to, $pairs );
			}
		)
	);

	/**
	 * Filters the posts offered for an update after a conversion.
	 *
	 * @since 1.0.0
	 *
	 * @param array[] $rows Usage rows.
	 * @param int     $from The attachment posts use now.
	 * @param int     $to   The attachment they should use.
	 */
	return array_values( (array) apply_filters( 'atme_reference_candidates', $rows, $from, $to ) );
}

/**
 * Moves one post from one attachment to its converted file.
 *
 * Content through {@see atme_rewrite_content_references()} and
 * `wp_update_post()` — a revision when the type keeps them, and the same
 * kses a manual save would apply. For a copy, a featured image that named
 * the source is pointed at the copy.
 *
 * @since 1.0.0
 *
 * @param int $post_id The post to update.
 * @param int $from    The attachment it uses now.
 * @param int $to      The attachment it should use.
 * @return array|WP_Error {
 *     What happened.
 *
 *     @type int    $postId   The post.
 *     @type string $title    Its title.
 *     @type int    $replaced References rewritten in the content.
 *     @type bool   $featured Whether the featured image moved.
 *     @type bool   $changed  Whether anything was written at all.
 * }
 */
function atme_update_post_references( $post_id, $from, $to ) {
	$post_id = (int) $post_id;
	$from    = (int) $from;
	$to      = (int) $to;

	$valid = atme_validate_reference_pair( $from, $to );

	if ( is_wp_error( $valid ) ) {
		return $valid;
	}

	$post = get_post( $post_id );

	if ( ! $post || in_array( $post->post_type, array( 'revision', 'attachment' ), true ) ) {
		return new WP_Error( 'atme_no_such_post', __( 'That post no longer exists.', 'allterrain-maia' ), array( 'status' => 404 ) );
	}

	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return new WP_Error( 'atme_cannot_edit_post', __( 'You are not allowed to edit that post.', 'allterrain-maia' ), array( 'status' => 403 ) );
	}

	$pairs = atme_reference_url_pairs( $from, $to );

	list( $content, $replaced ) = atme_rewritten_post_content( $post, $from, $to, $pairs );

	$result = array(
		'postId'   => $post_id,
		'title'    => get_the_title( $post_id ),
		'replaced' => (int) $replaced,
		'featured' => false,
		'changed'  => false,
	);

	if ( $content !== $post->post_content ) {
		$updated = wp_update_post(
			wp_slash(
				array(
					'ID'           => $post_id,
					'post_content' => $content,
				)
			),
			true
		);

		if ( is_wp_error( $updated ) ) {
			return $updated;
		}

		$result['changed'] = true;
	}

	if ( $from !== $to && (int) get_post_thumbnail_id( $post_id ) === $from ) {
		set_post_thumbnail( $post_id, $to );

		$result['featured'] = true;
		$result['changed']  = true;
	}

	/**
	 * Fires after a post has been moved to a converted file.
	 *
	 * Fires for unchanged posts too, so a builder storing its own copy of
	 * the URL in meta gets its chance either way.
	 *
	 * @since 1.0.0
	 *
	 * @param int   $post_id The post.
	 * @param int   $from    The attachment it used.
	 * @param int   $to      The attachment it uses now.
	 * @param array $result  See the return value.
	 */
	do_action( 'atme_post_references_updated', $post_id, $from, $to, $result );

	return $result;
}

/**
 * A post's content with its references moved, filters applied.
 *
 * @since 1.0.0
 *
 * @param WP_Post $post  The post.
 * @param int     $from  The attachment it uses now.
 * @param int     $to    The attachment it should use.
 * @param array   $pairs Old URL → new URL.
 * @return array { 0: string content, 1: int references changed }
 */
function atme_rewritten_post_content( $post, $from, $to, $pairs ) {
	list( $content, $replaced ) = atme_rewrite_content_references( $post->post_content, $from, $to, $pairs );

	/**
	 * Filters a post's content after its references have been rewritten.
	 *
	 * The seam for markup this plugin does not know — a gallery shortcode of
	 * some other plugin's, a builder's inline JSON.
	 *
	 * @since 1.0.0
	 *
	 * @param string  $content The rewritten content.
	 * @param WP_Post $post    The post, with its content as stored.
	 * @param int     $from    The attachment it used.
	 * @param int     $to      The attachment it should use.
	 * @param array   $pairs   Old URL → new URL.
	 */
	$content = (string) apply_filters( 'atme_rewrite_post_references', $content, $post, $from, $to, $pairs );

	return array( $content, $replaced );
}

/**
 * Whether updating a post would change anything — the dry run.
 *
 * @since 1.0.0
 *
 * @param int   $post_id The post.
 * @param int   $from    The attachment it uses now.
 * @param int   $to      The attachment it should use.
 * @param array $pairs   Old URL → new URL.
 * @return bool True when its content or featured image would move.
 */
function atme_post_needs_reference_update( $post_id, $from, $to, $pairs ) {
	$post = get_post( $post_id );

	if ( ! $post ) {
		return false;
	}

	if ( $from !== $to && (int) get_post_thumbnail_id( $post_id ) === $from ) {
		return true;
	}

	list( $content ) = atme_rewritten_post_content( $post, $from, $to, $pairs );

	return $content !== $post->post_content;
}
