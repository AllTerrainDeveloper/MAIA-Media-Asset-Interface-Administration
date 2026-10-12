/**
 * Which attachment a WP Explorer preview action was invoked on.
 *
 * WP Explorer hands `onSelect` its `PreviewActionContext`: the selected
 * entity under `item` and a numeric convenience copy of its id under
 * `itemId`. There is no `mediaId` or `postId` — reading those once made
 * "Reveal in AllTerrain MAIA" open the library with nothing selected.
 */

/** The fields of WP Explorer's preview-action context this plugin reads. */
export interface PreviewActionContext {
	itemId?: number;
	item?: { id?: unknown };
}

/** The attachment id the action targets, or 0 when there is none. */
export function previewActionMediaId( context: PreviewActionContext | null | undefined ): number {
	const id = Number( context?.itemId ?? context?.item?.id ?? 0 );

	return Number.isSafeInteger( id ) && id > 0 ? id : 0;
}
