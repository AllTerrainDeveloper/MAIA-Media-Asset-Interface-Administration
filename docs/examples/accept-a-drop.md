# Accept media dragged out of the explorer

Tiles carry the shell's `shortcut` payload. Register a drop target and read
the selection with the top-level-plus-`items` convention:

```javascript
wp.os.ready( () => {
	const off = wp.os.dragManager.registerDropTarget( {
		id: 'my-plugin/gallery-well',
		element: document.querySelector( '#my-gallery-well' ),
		accept: ( payload ) => {
			if ( payload.type !== 'shortcut' && payload.type !== 'desktop-file' ) {
				return false;
			}
			const members = payload.data.items?.length ? payload.data.items : [ payload.data ];
			return members.some( ( m ) => m.kind === 'attachment' );
		},
		acceptLabel: 'Add to gallery',
		onDrop: ( session ) => {
			const members = session.payload.data.items?.length
				? session.payload.data.items
				: [ session.payload.data ];
			const ids = members
				.filter( ( m ) => m.kind === 'attachment' )
				.map( ( m ) => Number( m.ref ) );
			myGallery.add( ids );
		},
	} );
	// call off() on unmount
} );
```

Refuse the whole set if any member fails your gate — a drop that half-lands
reads as data loss.
