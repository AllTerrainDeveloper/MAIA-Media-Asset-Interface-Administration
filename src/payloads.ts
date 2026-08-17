/**
 * What a lifted tile carries.
 *
 * The payload is the shell's own `'shortcut'` shape with `kind:
 * 'attachment'` — byte-for-byte the one WP Explorer's media grid emits — so
 * every drop target already written against that shape accepts our tiles
 * with no code written for us: kanban cards, image fields, wallpaper
 * folders, and Gutenberg iframes through the `bridgePayload` the shell fans
 * into its cross-frame bridge automatically.
 *
 * Multi-select rides the same convention: the grabbed item's fields at the
 * top level, the whole selection under `items`, which is exactly what the
 * shell's `dragShortcutItems()` helper reads on the receiving side.
 */

import type { AttachmentBridgePayload, DragPayload, MediaItem } from './types';
import { SHORTCUT_PAYLOAD_TYPE } from './types';

/** One selection member, in the shell's shortcut-item shape. */
interface ShortcutItem {
	kind: 'attachment';
	ref: string;
	title: string;
	icon: string;
	entityId: 'media';
	bridgePayload: AttachmentBridgePayload;
}

/** The dashicon a tile advertises when it has no thumbnail to show. */
function iconFor( item: MediaItem ): string {
	switch ( item.kind ) {
		case 'image':
			return 'dashicons-format-image';
		case 'video':
			return 'dashicons-format-video';
		case 'audio':
			return 'dashicons-format-audio';
		default:
			return 'dashicons-media-default';
	}
}

/** One item in the shell's shortcut-item shape. */
function shortcutItem( item: MediaItem ): ShortcutItem {
	return {
		kind: 'attachment',
		ref: String( item.id ),
		title: item.title || item.url.split( '/' ).pop() || `#${ item.id }`,
		icon: iconFor( item ),
		entityId: 'media',
		bridgePayload: {
			kind: 'attachment',
			id: item.id,
			url: item.url,
			title: item.title,
			alt: item.alt,
			mime: item.mime,
			thumbnailUrl: item.thumbnail || undefined,
		},
	};
}

/**
 * The payload for a drag starting on `grabbed`, carrying `set`.
 *
 * @param grabbed The item under the pointer.
 * @param set     The full set travelling — the selection when the grab landed
 *                inside it, just the grabbed item otherwise.
 * @param source  The tile element, for the ghost.
 * @param origin  The pointerdown that started it.
 */
export function attachmentPayload(
	grabbed: MediaItem,
	set: MediaItem[],
	source: HTMLElement,
	origin: PointerEvent
): DragPayload {
	const rect = source.getBoundingClientRect();
	const top = shortcutItem( grabbed );

	return {
		type: SHORTCUT_PAYLOAD_TYPE,
		source,
		data: {
			...top,
			items: set.map( shortcutItem ),
		},
		ghost: {
			// Measured, never 0,0 — a ghost that snaps its corner to the
			// pointer reads as the tile jumping out from under the hand.
			offsetX: origin.clientX - rect.left,
			offsetY: origin.clientY - rect.top,
			hint: { hidden: false },
		},
	};
}
