/**
 * The wire shapes.
 *
 * `MediaItem` is the TypeScript twin of what `/wp/v2/media` returns through
 * the `_fields` list in `api.ts`; the `atme/v1` shapes mirror their PHP
 * builders in `includes/`. When one side changes the other has to, and the
 * phpunit suite asserts the PHP keys so the pair cannot drift silently.
 */

/** One media item, as the grid and inspector see it. */
export interface MediaItem {
	id: number;
	title: string;
	/** ISO 8601. */
	date: string;
	mime: string;
	/** `image` | `video` | `audio` | `application` … — the MIME's left half. */
	kind: string;
	url: string;
	/** Best small preview URL, or empty for kinds with none. */
	thumbnail: string;
	alt: string;
	caption: string;
	description: string;
	width: number;
	height: number;
	/** Bytes on disk, when the REST payload knew it. */
	bytes: number;
	authorId: number;
	/** Post the file is attached to, 0 for unattached. */
	parent: number;
	/** Folder term ids. */
	folders: number[];
}

/** The library query the grid renders. One object, serializable, shareable. */
export interface LibraryQuery {
	search: string;
	/** MIME left-half filter: '' | 'image' | 'video' | 'audio' | 'application'. */
	kind: string;
	/** Folder term id, 0 for everything. */
	folder: number;
	/** A smart view slug, '' for none. */
	view: string;
	orderby: 'date' | 'title' | 'id';
	order: 'asc' | 'desc';
}

/** One folder row; the client nests them by `parent`. */
export interface Folder {
	id: number;
	name: string;
	parent: number;
	count: number;
}

/** File facts from `atme/v1/facts`. */
export interface FileFacts {
	exists: boolean;
	bytes: number;
	width: number;
	height: number;
	mime: string;
}

/** One row of "used in". */
export interface UsageRow {
	postId: number;
	title: string;
	type: string;
	typeLabel: string;
	usedAs: string;
	editUrl: string;
}

/** One stashed version. */
export interface Version {
	file: string;
	bytes: number;
	mime: string;
	date: string;
	author: string;
}

/** One wizard finding. */
export interface Finding {
	id: number;
	title: string;
	kind: 'oversized' | 'legacy-format' | 'missing-alt' | 'duplicate' | 'missing-file';
	detail: string;
	/** Present on findings a remedy needs the format of. */
	mime?: string;
}

/** One scan chunk. */
export interface ScanChunk {
	total: number;
	next: number;
	findings: Finding[];
}

/** What the server can encode and decode, probed in PHP. */
export interface ConversionCapabilities {
	imagick: boolean;
	gd: boolean;
	encode: Record< string, boolean >;
	decode: Record< string, boolean >;
}

/** The config PHP prints as `window.allTerrainMediaExplorer`. */
export interface Config {
	restUrl: string;
	wpRestUrl: string;
	nonce: string;
	adminUrl: string;
	uploadUrl: string;
	folderField: string;
	canUpload: boolean;
	viewerId: number;
	conversion: ConversionCapabilities;
	maxUploadMb: number;
	version: string;
}

/**
 * The slice of OpenStation this plugin touches.
 *
 * Declared structurally rather than imported from the `openstation` package:
 * at build time there is no copy of the shell on disk to resolve against, and
 * every call site null-checks so a missing or older shell degrades instead of
 * throwing.
 */
export interface ShellApi {
	dragManager?: DragManagerApi;
	openWindow?: (
		id: string,
		opts?: { source?: string; params?: Record< string, string | number | boolean > }
	) => boolean;
	notify?: ( opts: { title?: string; body?: string; type?: string } ) => () => void;
	showToast?: ( opts: {
		message: string;
		duration?: number;
		action?: { label: string; onClick: () => void };
	} ) => () => void;
	confirm?: ( opts: {
		title?: string;
		message?: string;
		confirmLabel?: string;
		danger?: boolean;
	} ) => Promise< boolean >;
	fetch?: (
		input: string,
		init?: RequestInit,
		opts?: { source?: string; silent?: boolean }
	) => Promise< Response >;
	broadcast?: < T >( topic: string, payload: T ) => void;
	subscribe?: ( topic: string, cb: ( payload: unknown ) => void ) => () => void;
	windowManager?: {
		open?: ( config: {
			id: string;
			baseId?: string;
			url: string;
			title: string;
			icon?: string;
		} ) => unknown;
		getById?: ( id: string ) => { setTitle?: ( title: string ) => void } | undefined;
	};
	deriveWindowId?: ( url: string, adminUrl?: string ) => string;
	loadComponents?: ( tags?: string[] ) => Promise< void >;
	registerCommand?: ( def: {
		slug: string;
		label: string;
		description?: string;
		hint?: string;
		icon?: string;
		run: ( args: string, ctx?: unknown ) => unknown;
	} ) => void;
	files?: {
		getUserAssociations?: () => Record< string, string >;
		setUserAssociations?: ( map: Record< string, string > ) => void;
		getOpener?: ( id: string ) => {
			id: string;
			label: string;
			types: string[];
			sort?: number;
			isDefault?: boolean;
			handler: { kind: 'url' | 'window' | 'js' };
		} | undefined;
		registerTilePayloadHandler?: (
			payloadType: string,
			handler: {
				appliesTo?: ( ctx: { placement?: { file?: { ref?: string; type?: string } } } ) => boolean;
				accept: ( data: Record< string, unknown > ) => boolean;
				acceptLabel?: string;
				onDrop: ( session: { payload: { data: Record< string, unknown > } } ) => void;
			}
		) => () => void;
		registerOpener?: ( def: {
			id: string;
			label: string;
			types: string[];
			sort?: number;
			isDefault?: boolean;
			handler: {
				kind: 'url' | 'window' | 'js';
				url?: ( file: unknown ) => string;
				windowId?: string;
				/** The `js` kind's entry point — the shell calls `open( file )`. */
				open?: ( file: { ref: () => string } ) => void;
			};
		} ) => void;
	};
	relations?: {
		set?: ( windowId: string, ref: unknown ) => void;
		get?: ( windowId: string ) => unknown;
	};
	myWordpress?: {
		openMedia?: ( opts: { mediaId: number; mediaTitle?: string } ) => void;
	};
	ai?: {
		ask?: ( prompt: string, opts?: Record< string, unknown > ) => Promise< string >;
	};
	config?: { adminUrl?: string };
	hooks?: {
		addFilter: ( hook: string, ns: string, cb: ( ...args: unknown[] ) => unknown, prio?: number ) => void;
		addAction: ( hook: string, ns: string, cb: ( ...args: unknown[] ) => unknown, prio?: number ) => void;
	};
	dock?: { setBadge?: ( id: string, count: number ) => void };
	sideDock?: { setBadge?: ( id: string, count: number ) => void };
	icons?: { setBadge?: ( id: string, count: number ) => void };
	ready?: ( cb: () => void ) => void;
	isActive?: () => boolean;
	getWindowConfig?: < T >( id: string ) => T | undefined;
}

/** `wp.os.dragManager`, narrowed to what the explorer uses. */
export interface DragManagerApi {
	start( opts: DragStartOpts ): DragSession | null;
	registerDropTarget( target: DropTarget ): () => void;
	isDragging(): boolean;
	recentlyEndedDrag( withinMs?: number ): boolean;
}

export interface DragPayload {
	type: string;
	source: HTMLElement;
	data: Record< string, unknown >;
	ghost?: {
		element?: HTMLElement;
		offsetX: number;
		offsetY: number;
		hint?: { hidden?: boolean; accept?: string; reject?: string; neutral?: string };
	};
}

export interface DragSession {
	readonly payload: DragPayload;
	isFinished(): boolean;
	cancel( reason?: string ): void;
}

export interface DragStartOpts {
	payload: DragPayload;
	origin: PointerEvent;
	onClickOnly?: () => void;
	onCancel?: ( reason: string ) => void;
	onCommit?: ( target: DropTarget ) => void;
}

export interface DropTarget {
	id: string;
	element: HTMLElement;
	accept( payload: DragPayload ): boolean;
	onEnter?( session: DragSession ): void;
	onLeave?( session: DragSession ): void;
	onDrop( session: DragSession, ev: { clientX: number; clientY: number } ): void | Promise< void >;
	acceptLabel?: string;
}

/**
 * The payload type this plugin emits when a tile is lifted.
 *
 * Deliberately the shell's own `'shortcut'` slug rather than a private one:
 * every drop target on the desktop that understands a shortcut to an
 * attachment — a kanban card, an image field, a wallpaper folder, Gutenberg
 * through the iframe bridge — accepts a tile from this grid with zero code
 * written for us. Interop first; a private slug would have bought nothing.
 */
export const SHORTCUT_PAYLOAD_TYPE = 'shortcut';

/** The bridge payload attached to a lifted tile, for cross-iframe drops. */
export interface AttachmentBridgePayload {
	kind: 'attachment';
	id: number;
	url: string;
	title: string;
	alt: string;
	mime: string;
	thumbnailUrl?: string;
}
