# Report your plugin's media usage

If your plugin references attachments in its own meta, tell the explorer —
its "Used in" panel, delete guard and window relations all read one filter:

```php
add_filter( 'atme_media_usage', function ( $rows, $attachment_id ) {
	foreach ( my_plugin_galleries_using( $attachment_id ) as $gallery_id ) {
		$rows[] = array(
			'postId'    => $gallery_id,
			'title'     => get_the_title( $gallery_id ),
			'type'      => 'my-gallery',
			'typeLabel' => __( 'Gallery', 'my-plugin' ),
			'usedAs'    => 'meta',
			'editUrl'   => get_edit_post_link( $gallery_id, 'raw' ),
		);
	}
	return $rows;
}, 10, 2 );
```
