# Add a smart view

Server half — narrow the query when your view is asked for:

```php
add_filter( 'atme_view_query', function ( $args, $view ) {
	if ( 'my-plugin-huge' === $view ) {
		$args['meta_query'][] = array(
			'key'     => '_my_plugin_flagged',
			'compare' => 'EXISTS',
		);
	}
	return $args;
}, 10, 2 );
```

Ask for it from anywhere: `GET /wp/v2/media?atme_view=my-plugin-huge`. The
sidebar's built-in list is not yet filterable client-side — Planned.
