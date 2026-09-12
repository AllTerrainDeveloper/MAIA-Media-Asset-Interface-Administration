/**
 * Talking to WordPress.
 *
 * One thin client shared by the explorer window and the eager shell bundle.
 * Two things it does that a bare `fetch()` would not:
 *
 *   1. Routes through `wp.os.fetch()` when the shell is present — the shell's
 *      fetch pulses the window's activity dot and refreshes a REST nonce that
 *      has gone stale mid-session. A raw `fetch()` in a desktop that has been
 *      open for six hours starts returning 403s that look like permission bugs.
 *   2. Turns a WordPress `WP_Error` JSON body into a thrown `ApiError`
 *      carrying the server's own message, so the UI can show what actually
 *      went wrong instead of "Request failed".
 *
 * Browsing rides core's `/wp/v2/media` with an explicit `_fields` list; the
 * plugin's own namespace only carries the verbs core cannot say.
 */

import type {
	Config,
	FileFacts,
	Folder,
	LibraryQuery,
	MediaItem,
	ScanChunk,
	ShellApi,
	UsageRow,
	Version,
} from './types';

/**
 * The framework's content-change topic this plugin listens on.
 *
 * `os.<post-type>.changed` — attachments are posts, so a replace made in one
 * window, an upload dropped on the wallpaper, or a delete in WP Explorer all
 * arrive here without any private wiring.
 */
export const CHANGE_TOPIC = 'os.attachment.changed';

/**
 * How this *bundle instance* identifies its own broadcasts.
 *
 * Per-instance rather than per-plugin: two explorer windows are two mounts of
 * this module, and each must hear the other's writes. A shared source id
 * would make them ignore exactly the peers they exist to mirror.
 */
export const BROADCAST_SOURCE = `allterrain-media-explorer/${ Math.random().toString( 36 ).slice( 2, 10 ) }`;

/** An error the server described. `code` is the `WP_Error` code. */
export class ApiError extends Error {
	public readonly code: string;
	public readonly status: number;

	constructor( message: string, code: string, status: number ) {
		super( message );
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
	}
}

/**
 * Reads the config PHP printed.
 *
 * Throws rather than returning a default, because every caller needs the REST
 * nonce, and a grid silently issuing unauthenticated requests would look like
 * an empty library rather than a broken one.
 */
export function getConfig(): Config {
	const config = ( window as unknown as { allTerrainMediaExplorer?: Config } )
		.allTerrainMediaExplorer;

	if ( ! config || ! config.restUrl ) {
		throw new Error(
			'[allterrain-media-explorer] window.allTerrainMediaExplorer is missing. The `allterrain-media-explorer-config` script handle was not enqueued on this page.'
		);
	}

	return config;
}

/** The shell, if this page has one. */
export function getShell(): ShellApi | null {
	const wp = ( window as unknown as { wp?: { os?: ShellApi } } ).wp;

	return wp?.os ?? null;
}

/** Whether the desktop shell is mounted and usable right now. */
export function shellIsActive(): boolean {
	const shell = getShell();

	return !! shell && ( shell.isActive ? shell.isActive() : !! shell.dragManager );
}

/**
 * One request against an absolute URL.
 *
 * @param url    Full URL.
 * @param init   Fetch options. `method` defaults to GET.
 * @param silent Suppress the shell's activity indicator, for background work.
 */
async function requestUrl< T >( url: string, init: RequestInit = {}, silent = false ): Promise< { body: T; response: Response } > {
	const config = getConfig();
	const shell = getShell();

	const headers: Record< string, string > = {
		Accept: 'application/json',
		...( ( init.headers as Record< string, string > ) ?? {} ),
	};

	if ( init.body && typeof init.body === 'string' ) {
		headers[ 'Content-Type' ] = 'application/json';
	}

	// The shell injects the nonce itself and keeps it fresh; without the
	// shell nobody else will, so send the one PHP printed.
	if ( ! shell?.fetch ) {
		headers[ 'X-WP-Nonce' ] = config.nonce;
	}

	const options: RequestInit = { credentials: 'same-origin', ...init, headers };

	const response = shell?.fetch
		? await shell.fetch( url, options, { source: 'allterrain-media-explorer', silent } )
		: await fetch( url, options );

	if ( ! response.ok ) {
		let message = response.statusText || 'Request failed';
		let code = 'atme_request_failed';

		try {
			const body = ( await response.json() ) as { message?: string; code?: string };
			message = body.message ?? message;
			code = body.code ?? code;
		} catch {
			// A non-JSON error body — a PHP fatal, an nginx page, a login
			// redirect. The status line is all there is to report.
		}

		throw new ApiError( message, code, response.status );
	}

	if ( response.status === 204 ) {
		return { body: undefined as T, response };
	}

	return { body: ( await response.json() ) as T, response };
}

/** Join a namespace and route without putting query args inside rest_route. */
export function restEndpoint( base: string, path: string ): string {
	const url = new URL( base, window.location.href );
	const split = path.indexOf( '?' );
	const route = split < 0 ? path : path.slice( 0, split );
	const query = split < 0 ? '' : path.slice( split + 1 );
	if ( url.searchParams.has( 'rest_route' ) ) {
		url.searchParams.set( 'rest_route', url.searchParams.get( 'rest_route' )!.replace( /\/$/, '' ) + route );
	} else {
		url.pathname = url.pathname.replace( /\/$/, '' ) + route;
	}
	new URLSearchParams( query ).forEach( ( value, key ) => url.searchParams.append( key, value ) );
	return url.href;
}

/** One request under the plugin's own namespace. */
async function request< T >( path: string, init: RequestInit = {}, silent = false ): Promise< T > {
	const config = getConfig();

	return ( await requestUrl< T >( restEndpoint( config.restUrl, path ), init, silent ) ).body;
}

/** One request under `/wp/v2`. */
async function wpRequest< T >( path: string, init: RequestInit = {}, silent = false ): Promise< { body: T; response: Response } > {
	const config = getConfig();

	return requestUrl< T >( restEndpoint( config.wpRestUrl, path ), init, silent );
}

/** The `_fields` list one media row needs — nothing else crosses the wire. */
const MEDIA_FIELDS = [
	'id',
	'title.rendered',
	'date_gmt',
	'mime_type',
	'media_type',
	'source_url',
	'alt_text',
	'caption.rendered',
	'description.rendered',
	'media_details.width',
	'media_details.height',
	'media_details.filesize',
	'media_details.sizes.medium.source_url',
	'media_details.sizes.thumbnail.source_url',
	'author',
	'post',
	'atme-folders',
].join( ',' );

/** The raw REST row `MEDIA_FIELDS` produces. */
interface RawMedia {
	id: number;
	title?: { rendered?: string };
	date_gmt?: string;
	mime_type?: string;
	media_type?: string;
	source_url?: string;
	alt_text?: string;
	caption?: { rendered?: string };
	description?: { rendered?: string };
	media_details?: {
		width?: number;
		height?: number;
		filesize?: number;
		sizes?: Record< string, { source_url?: string } >;
	};
	author?: number;
	post?: number | null;
	'atme-folders'?: number[];
}

/** Strips markup a `rendered` field may carry down to text. */
function textOf( rendered?: string ): string {
	if ( ! rendered ) {
		return '';
	}

	const template = document.createElement( 'template' );

	// Template contents are inert: event handlers and resource loads never run.
	template.innerHTML = rendered;

	return ( template.content.textContent ?? '' ).trim();
}

/** One REST row → one grid item. */
function toMediaItem( raw: RawMedia ): MediaItem {
	const sizes = raw.media_details?.sizes ?? {};
	const mime = raw.mime_type ?? '';

	return {
		id: raw.id,
		title: textOf( raw.title?.rendered ),
		date: raw.date_gmt ?? '',
		mime,
		kind: raw.media_type === 'image' ? 'image' : mime.split( '/' )[ 0 ] || 'file',
		url: raw.source_url ?? '',
		thumbnail: sizes.medium?.source_url ?? sizes.thumbnail?.source_url ?? ( raw.media_type === 'image' ? raw.source_url ?? '' : '' ),
		alt: raw.alt_text ?? '',
		caption: textOf( raw.caption?.rendered ),
		description: textOf( raw.description?.rendered ),
		width: raw.media_details?.width ?? 0,
		height: raw.media_details?.height ?? 0,
		bytes: raw.media_details?.filesize ?? 0,
		authorId: raw.author ?? 0,
		parent: raw.post ?? 0,
		folders: raw[ 'atme-folders' ] ?? [],
	};
}

/** One page of the library. */
export interface MediaPage {
	items: MediaItem[];
	total: number;
	totalPages: number;
}

/**
 * Fetches one page of the library for a query.
 *
 * @param query   The library query.
 * @param page    1-based page.
 * @param perPage Page size.
 */
export async function fetchMedia( query: LibraryQuery, page = 1, perPage = 60 ): Promise< MediaPage > {
	const params = new URLSearchParams();

	params.set( '_fields', MEDIA_FIELDS );
	params.set( 'per_page', String( perPage ) );
	params.set( 'page', String( page ) );
	params.set( 'orderby', query.orderby );
	params.set( 'order', query.order );

	if ( query.search ) {
		params.set( 'search', query.search );
	}

	if ( query.kind ) {
		params.set( 'media_type', query.kind === 'application' ? 'application' : query.kind );
	}

	if ( query.folder > 0 ) {
		params.set( getConfig().folderField, String( query.folder ) );
	}

	if ( 'unattached' === query.view ) {
		params.set( 'parent', '0' );
	}

	if ( [ 'missing-alt', 'converted', 'unfiled' ].includes( query.view ) ) {
		params.set( 'atme_view', query.view );
	}

	const { body, response } = await wpRequest< RawMedia[] >( `/media?${ params.toString() }` );

	return {
		items: body.map( toMediaItem ),
		total: parseInt( response.headers.get( 'X-WP-Total' ) ?? '0', 10 ),
		totalPages: parseInt( response.headers.get( 'X-WP-TotalPages' ) ?? '0', 10 ),
	};
}

/** One media item, fresh. */
export async function fetchMediaItem( id: number ): Promise< MediaItem > {
	const { body } = await wpRequest< RawMedia >( `/media/${ id }?_fields=${ MEDIA_FIELDS }` );

	return toMediaItem( body );
}

/** Fields the inspector can write through core REST. */
export interface MediaEdits {
	title?: string;
	alt_text?: string;
	caption?: string;
	description?: string;
}

/** Saves inspector edits. */
export async function updateMedia( id: number, edits: MediaEdits ): Promise< MediaItem > {
	const { body } = await wpRequest< RawMedia >( `/media/${ id }?_fields=${ MEDIA_FIELDS }`, {
		method: 'POST',
		body: JSON.stringify( edits ),
	} );

	announceChange( id, 'updated' );

	return toMediaItem( body );
}

/** Trashes or permanently deletes a media item. Attachments have no trash by default, so `force` is explicit. */
export async function deleteMedia( id: number, force: boolean ): Promise< void > {
	await wpRequest( `/media/${ id }?force=${ force ? 'true' : 'false' }`, { method: 'DELETE' } );

	announceChange( id, 'trashed' );
}

/** Uploads one file, optionally straight into a folder. */
export async function uploadMedia( file: File, folder = 0 ): Promise< MediaItem > {
	const form = new FormData();

	form.append( 'file', file, file.name );

	const { body } = await wpRequest< RawMedia >( '/media', { method: 'POST', body: form } );

	const item = toMediaItem( body );

	if ( folder > 0 ) {
		await fileIntoFolder( [ item.id ], folder );
		item.folders = [ ...item.folders, folder ];
	}

	announceChange( item.id, 'created' );

	return item;
}

/* ------------------------------------------------------------------------- *
 * The plugin's own verbs.
 * ------------------------------------------------------------------------- */

/** Conversion request. */
export interface ConvertArgs {
	format: string;
	quality?: number;
	strip_meta?: boolean;
	max_width?: number;
	rotate?: 0 | 90 | 180 | 270;
	replace?: boolean;
}

/**
 * Rotates an image in place: same format, same ID, a version stashed.
 *
 * Better than core's editor here — core's REST edit makes a detached copy;
 * this goes through the convert-replace pipeline, so it is undoable.
 */
export async function rotateMedia( id: number, mime: string, degrees: 90 | 180 | 270 ): Promise< void > {
	const format = mime.replace( 'image/', '' ).replace( 'jpg', 'jpeg' ) || 'jpeg';

	await convertMedia( id, { format, quality: 92, rotate: degrees, replace: true } );
	announceChange( id, 'updated' );
}

/** Converts an item; answers the resulting attachment id and fresh facts. */
export function convertMedia( id: number, args: ConvertArgs ): Promise< { id: number; replaced: boolean; facts: FileFacts } > {
	return request( '/convert', { method: 'POST', body: JSON.stringify( { id, ...args } ) } );
}

/** Replaces the file behind an item, keeping its ID and URL. */
export async function replaceMedia( id: number, file: File ): Promise< { id: number; facts: FileFacts } > {
	const config = getConfig();
	const shell = getShell();
	const form = new FormData();

	form.append( 'file', file, file.name );

	const url = restEndpoint( config.restUrl, `/replace/${ id }` );
	const options: RequestInit = { method: 'POST', credentials: 'same-origin', body: form };

	if ( ! shell?.fetch ) {
		options.headers = { 'X-WP-Nonce': config.nonce };
	}

	const response = shell?.fetch
		? await shell.fetch( url, options, { source: 'allterrain-media-explorer' } )
		: await fetch( url, options );

	if ( ! response.ok ) {
		const body = ( await response.json().catch( () => ( {} ) ) ) as { message?: string; code?: string };

		throw new ApiError( body.message ?? 'Replace failed', body.code ?? 'atme_request_failed', response.status );
	}

	announceChange( id, 'updated' );

	return ( await response.json() ) as { id: number; facts: FileFacts };
}

/** The version history, newest first. */
export function fetchVersions( id: number ): Promise< Version[] > {
	return request( `/versions/${ id }`, {}, true );
}

/** Rolls back to a stashed version. */
export async function rollbackVersion( id: number, file: string ): Promise< void > {
	await request( `/versions/${ id }`, { method: 'POST', body: JSON.stringify( { file } ) } );

	announceChange( id, 'updated' );
}

/** Everywhere the file is used. */
export function fetchUsage( id: number ): Promise< UsageRow[] > {
	return request( `/usage/${ id }`, {}, true );
}

/** File facts and provenance for the inspector. */
export function fetchFacts( id: number ): Promise< {
	facts: FileFacts;
	versions: number;
	convertedFrom: number;
	conversions: number[];
} > {
	return request( `/facts/${ id }`, {}, true );
}

/** Rebuilds an item's sub-sizes. */
export function regenerate( id: number ): Promise< { id: number } > {
	return request( '/regenerate', { method: 'POST', body: JSON.stringify( { id } ) } );
}

/** The folder tree. */
export function fetchFolders(): Promise< Folder[] > {
	return request( '/folders', {}, true );
}

/** A new folder. */
export function createFolder( name: string, parent = 0 ): Promise< { id: number } > {
	return request( '/folders', { method: 'POST', body: JSON.stringify( { name, parent } ) } );
}

/** Deletes only the term; WordPress preserves media and reparents child folders. */
export async function deleteFolder( id: number ): Promise< void > {
	await wpRequest( `/atme-folders/${ id }?force=true`, { method: 'DELETE' } );
}

/** Files items into a folder, additively. */
export function fileIntoFolder( ids: number[], folder: number ): Promise< { filed: number } > {
	return request( '/folders/file', { method: 'POST', body: JSON.stringify( { ids, folder } ) } );
}

/** Takes items out of a folder. */
export function unfileFromFolder( ids: number[], folder: number ): Promise< { unfiled: number } > {
	return request( '/folders/unfile', { method: 'POST', body: JSON.stringify( { ids, folder } ) } );
}

/** One wizard scan chunk. */
export function scanChunk( offset: number, limit = 25 ): Promise< ScanChunk > {
	return request( `/scan?offset=${ offset }&limit=${ limit }`, {}, true );
}

/** The saved wizard state, if a sweep is mid-flight. */
export function fetchWizardState< T >(): Promise< { state: T | null } > {
	return request( '/wizard-state', {}, true );
}

/** Keeps or clears the wizard state. */
export function saveWizardState< T >( state: T | null ): Promise< { saved: boolean } > {
	return request( '/wizard-state', { method: 'POST', body: JSON.stringify( { state } ) } );
}

/** Duplicate groups, from the hash index. */
export function fetchDuplicates(): Promise< { hashed: number; groups: Array< { hash: string; ids: number[] } > } > {
	return request( '/duplicates', {}, true );
}

/** Several specific items, for views assembled from an id list. */
export async function fetchMediaByIds( ids: number[] ): Promise< MediaItem[] > {
	if ( ids.length === 0 ) {
		return [];
	}

	const params = new URLSearchParams();

	params.set( '_fields', MEDIA_FIELDS );
	params.set( 'include', ids.join( ',' ) );
	params.set( 'orderby', 'include' );
	params.set( 'per_page', String( Math.min( 100, ids.length ) ) );

	const { body } = await wpRequest< RawMedia[] >( `/media?${ params.toString() }` );

	return body.map( toMediaItem );
}

/** One saved collection. */
export interface Collection {
	id: number;
	title: string;
	query: LibraryQuery;
}

/** Every saved collection. */
export async function fetchCollections(): Promise< Collection[] > {
	const { body } = await wpRequest< Array< { id: number; title?: { rendered?: string }; meta?: Record< string, string > } > >(
		'/atme-collections?per_page=100&_fields=id,title.rendered,meta',
		{},
		true
	);

	return body
		.map( ( raw ) => {
			let query: LibraryQuery | null = null;

			try {
				query = JSON.parse( raw.meta?.[ '_atme_query' ] ?? '' ) as LibraryQuery;
			} catch {
				query = null;
			}

			return query ? { id: raw.id, title: textOf( raw.title?.rendered ), query } : null;
		} )
		.filter( ( collection ): collection is Collection => !! collection );
}

/** Saves the current query as a collection. */
export async function createCollection( title: string, query: LibraryQuery ): Promise< Collection > {
	const { body } = await wpRequest< { id: number } >( '/atme-collections', {
		method: 'POST',
		body: JSON.stringify( {
			title,
			status: 'publish',
			meta: { _atme_query: JSON.stringify( query ) },
		} ),
	} );

	return { id: body.id, title, query };
}

/** Removes a collection. The media it described is untouched. */
export async function deleteCollection( id: number ): Promise< void > {
	await wpRequest( `/atme-collections/${ id }?force=true`, { method: 'DELETE' } );
}

/**
 * The items either side of one, walking the library newest-first.
 *
 * Date-keyed rather than position-keyed: the viewer is its own window and
 * cannot see any grid's paging, but upload date is a total-enough order for
 * ← / → to feel like flipping through the roll.
 */
export async function fetchNeighbors( item: MediaItem ): Promise< { prev: MediaItem | null; next: MediaItem | null } > {
	const base = `/media?_fields=${ MEDIA_FIELDS }&per_page=1`;

	const [ newer, older ] = await Promise.all( [
		wpRequest< RawMedia[] >( `${ base }&orderby=date&order=asc&after=${ encodeURIComponent( item.date + 'Z' ) }`, {}, true ),
		wpRequest< RawMedia[] >( `${ base }&orderby=date&order=desc&before=${ encodeURIComponent( item.date + 'Z' ) }`, {}, true ),
	] );

	return {
		prev: newer.body[ 0 ] ? toMediaItem( newer.body[ 0 ] ) : null,
		next: older.body[ 0 ] ? toMediaItem( older.body[ 0 ] ) : null,
	};
}

/* ------------------------------------------------------------------------- *
 * Liveness.
 * ------------------------------------------------------------------------- */

/** Tells every other surface an attachment changed. */
export function announceChange( id: number, action: 'created' | 'updated' | 'trashed' ): void {
	getShell()?.broadcast?.( CHANGE_TOPIC, { source: BROADCAST_SOURCE, action, ids: [ id ] } );
}

/**
 * Hears about attachments changing anywhere else.
 *
 * Skips only this module instance's own echoes; a second window, WP
 * Explorer and the Heartbeat relay all get through.
 *
 * @param cb Called with the changed ids.
 * @return Unsubscribe.
 */
export function onMediaChanged( cb: ( ids: number[] ) => void ): () => void {
	const shell = getShell();

	if ( ! shell?.subscribe ) {
		return () => undefined;
	}

	return shell.subscribe( CHANGE_TOPIC, ( payload ) => {
		const change = payload as { source?: string; ids?: number[] };

		if ( change?.source === BROADCAST_SOURCE ) {
			return;
		}

		cb( ( change?.ids ?? [] ).map( ( id ) => Number( id ) ) );
	} );
}
