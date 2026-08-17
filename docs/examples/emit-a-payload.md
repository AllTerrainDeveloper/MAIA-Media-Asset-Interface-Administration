# Make your items droppable onto the explorer

Anything that emits an attachment-shaped `shortcut` payload can be dropped
on the explorer's grid (files into the current folder) or on any folder row
(files into that folder):

```javascript
element.addEventListener( 'pointerdown', ( ev ) => {
	wp.os.dragManager.start( {
		origin: ev,
		payload: {
			type: 'shortcut',
			source: element,
			data: {
				kind: 'attachment',
				ref: String( attachmentId ),
				title: 'My photo',
				entityId: 'media',
				bridgePayload: { kind: 'attachment', id: attachmentId, url, title: 'My photo', alt: '', mime: 'image/jpeg' },
			},
			ghost: { offsetX: 12, offsetY: 12 },
		},
	} );
} );
```
