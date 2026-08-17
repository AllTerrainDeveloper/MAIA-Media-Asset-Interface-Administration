/**
 * The grid: tiles, selection, keyboard, infinite scroll, drag-out.
 *
 * Plain DOM by decision. A media grid's jobs — accessibility, text, native
 * scroll physics, focus order — are DOM jobs, and a GPU canvas would cost
 * keyboard and screen-reader parity to buy nothing a CSS grid doesn't
 * already deliver. Tiles are recycled per render pass keyed by id, so a
 * refresh repaints only what changed.
 */

import type { DragManagerApi, MediaItem } from './types';
import { SelectionModel } from './selection';
import { attachmentPayload } from './payloads';

/** What the grid reports up to the app. */
export interface GridDelegate {
	/** A tile was opened — double-click or Enter. */
	onOpen( item: MediaItem ): void;
	/** The selection changed. */
	onSelection( ids: number[] ): void;
	/** The reader scrolled near the end; fetch another page. */
	onNeedMore(): void;
}

/** The grid over one query's results. */
export class MediaGrid {
	private readonly list: HTMLElement;
	private readonly sentinel: HTMLElement;
	private readonly delegate: GridDelegate;
	private readonly dnd: DragManagerApi;
	private readonly selection = new SelectionModel();
	private readonly observer: IntersectionObserver | null;
	private items: MediaItem[] = [];
	private byId = new Map< number, MediaItem >();
	private tiles = new Map< number, HTMLElement >();
	private focusedId = 0;
	private keyHandler: ( ( event: KeyboardEvent ) => void ) | null = null;

	constructor( host: HTMLElement, dnd: DragManagerApi, delegate: GridDelegate ) {
		this.dnd = dnd;
		this.delegate = delegate;

		this.list = document.createElement( 'div' );
		this.list.className = 'atme-grid';
		this.list.setAttribute( 'role', 'listbox' );
		this.list.setAttribute( 'aria-multiselectable', 'true' );
		this.list.setAttribute( 'aria-label', 'Media library' );
		this.list.tabIndex = 0;

		this.sentinel = document.createElement( 'div' );
		this.sentinel.className = 'atme-grid__sentinel';

		host.appendChild( this.list );
		host.appendChild( this.sentinel );

		// jsdom has no IntersectionObserver; scrolling simply never asks for
		// more there, which the tests neither need nor miss.
		this.observer =
			typeof IntersectionObserver !== 'undefined'
				? new IntersectionObserver(
						( entries ) => {
							if ( entries.some( ( entry ) => entry.isIntersecting ) ) {
								this.delegate.onNeedMore();
							}
						},
						{ root: host, rootMargin: '600px' }
				  )
				: null;

		this.observer?.observe( this.sentinel );

		// Window-level capture: the shell's document-capture handler owns
		// bare arrows (Space switching) before any element listener could
		// run, and Window capture is the one slot ahead of it.
		this.keyHandler = ( event: KeyboardEvent ) => {
			const target = event.target as HTMLElement | null;

			if ( target && this.list.contains( target ) ) {
				this.onKeydown( event );
			}
		};
		window.addEventListener( 'keydown', this.keyHandler, true );

		// Click on the empty ground clears the selection — the wallpaper rule.
		this.list.addEventListener( 'pointerdown', ( event ) => {
			if ( event.target === this.list && ! this.dnd.recentlyEndedDrag?.() ) {
				this.selection.clear();
				this.paintSelection();
				this.delegate.onSelection( [] );
			}
		} );
	}

	/** Switches between the tile grid and the detail list. */
	public setLayout( layout: 'grid' | 'list' ): void {
		this.list.classList.toggle( 'atme-grid--list', 'list' === layout );
	}

	/** Replaces the whole result set (a new query). */
	public setItems( items: MediaItem[] ): void {
		this.items = [ ...items ];
		this.sync();
	}

	/** Appends a page (infinite scroll). */
	public appendItems( items: MediaItem[] ): void {
		const known = new Set( this.items.map( ( item ) => item.id ) );

		this.items = [ ...this.items, ...items.filter( ( item ) => ! known.has( item.id ) ) ];
		this.sync();
	}

	/** Patches single items in place after an edit elsewhere. */
	public patchItems( items: MediaItem[] ): void {
		const patch = new Map( items.map( ( item ) => [ item.id, item ] ) );

		this.items = this.items.map( ( item ) => patch.get( item.id ) ?? item );
		this.sync();
	}

	/** Drops items that no longer exist. */
	public removeItems( ids: number[] ): void {
		const gone = new Set( ids );

		this.items = this.items.filter( ( item ) => ! gone.has( item.id ) );
		this.sync();
	}

	public getItems(): MediaItem[] {
		return [ ...this.items ];
	}

	public selectedIds(): number[] {
		return this.selection.ids();
	}

	public selectedItems(): MediaItem[] {
		return this.selection.ids().map( ( id ) => this.byId.get( id ) ) .filter( ( item ): item is MediaItem => !! item );
	}

	public selectAll(): void {
		this.selection.selectAll();
		this.paintSelection();
		this.delegate.onSelection( this.selection.ids() );
	}

	public clearSelection(): void {
		this.selection.clear();
		this.paintSelection();
		this.delegate.onSelection( [] );
	}

	/** Scrolls one item into view and selects it — the "reveal" verb. */
	public reveal( id: number ): void {
		if ( ! this.byId.has( id ) ) {
			return;
		}

		this.selection.select( id );
		this.paintSelection();
		this.delegate.onSelection( this.selection.ids() );
		this.tiles.get( id )?.scrollIntoView( { block: 'center', behavior: 'smooth' } );
	}

	/** Rebuilds the DOM to match `items`, recycling tiles by id. */
	private sync(): void {
		this.byId = new Map( this.items.map( ( item ) => [ item.id, item ] ) );
		this.selection.setOrder( this.items.map( ( item ) => item.id ) );

		const wanted = new Set( this.items.map( ( item ) => item.id ) );

		for ( const [ id, tile ] of this.tiles ) {
			if ( ! wanted.has( id ) ) {
				tile.remove();
				this.tiles.delete( id );
			}
		}

		let previous: HTMLElement | null = null;

		for ( const item of this.items ) {
			let tile = this.tiles.get( item.id );

			if ( ! tile ) {
				tile = this.buildTile( item );
				this.tiles.set( item.id, tile );
			} else {
				this.updateTile( tile, item );
			}

			// Keep DOM order equal to item order without rebuilding.
			if ( previous ) {
				if ( previous.nextElementSibling !== tile ) {
					previous.after( tile );
				}
			} else if ( this.list.firstElementChild !== tile ) {
				this.list.prepend( tile );
			}

			previous = tile;
		}

		this.paintSelection();
	}

	private buildTile( item: MediaItem ): HTMLElement {
		const tile = document.createElement( 'div' );

		tile.className = 'atme-tile';
		tile.setAttribute( 'role', 'option' );
		tile.tabIndex = -1;
		tile.dataset.id = String( item.id );

		const preview = document.createElement( 'div' );

		preview.className = 'atme-tile__preview';
		tile.appendChild( preview );

		const name = document.createElement( 'div' );

		name.className = 'atme-tile__name';
		tile.appendChild( name );

		const meta = document.createElement( 'div' );

		meta.className = 'atme-tile__meta';
		tile.appendChild( meta );

		this.updateTile( tile, item );

		tile.addEventListener( 'pointerdown', ( event ) => this.onTilePointerDown( event, tile ) );
		tile.addEventListener( 'dblclick', () => {
			const current = this.byId.get( item.id );

			if ( current ) {
				this.delegate.onOpen( current );
			}
		} );

		return tile;
	}

	private updateTile( tile: HTMLElement, item: MediaItem ): void {
		const preview = tile.querySelector< HTMLElement >( '.atme-tile__preview' );
		const name = tile.querySelector< HTMLElement >( '.atme-tile__name' );

		if ( name ) {
			name.textContent = item.title || item.url.split( '/' ).pop() || `#${ item.id }`;
		}

		tile.setAttribute( 'aria-label', item.title || `Media ${ item.id }` );

		const meta = tile.querySelector< HTMLElement >( '.atme-tile__meta' );

		if ( meta ) {
			const parts = [ item.mime ];

			if ( item.date ) {
				parts.push( new Date( item.date + 'Z' ).toLocaleDateString() );
			}

			if ( item.width > 0 ) {
				parts.push( `${ item.width }×${ item.height }` );
			}

			meta.textContent = parts.join( ' · ' );
		}

		if ( ! preview ) {
			return;
		}

		if ( item.thumbnail ) {
			let img = preview.querySelector< HTMLImageElement >( 'img' );

			if ( ! img ) {
				preview.textContent = '';
				img = document.createElement( 'img' );
				img.loading = 'lazy';
				img.draggable = false;
				preview.appendChild( img );
			}

			if ( img.getAttribute( 'src' ) !== item.thumbnail ) {
				img.src = item.thumbnail;
			}

			img.alt = '';
		} else {
			preview.textContent = '';

			const icon = document.createElement( 'span' );

			icon.className = `dashicons ${ this.kindIcon( item ) }`;
			preview.appendChild( icon );

			const ext = document.createElement( 'span' );

			ext.className = 'atme-tile__ext';
			ext.textContent = ( item.url.split( '.' ).pop() ?? '' ).toUpperCase().slice( 0, 5 );
			preview.appendChild( ext );
		}
	}

	private kindIcon( item: MediaItem ): string {
		switch ( item.kind ) {
			case 'video':
				return 'dashicons-format-video';
			case 'audio':
				return 'dashicons-format-audio';
			default:
				return 'dashicons-media-default';
		}
	}

	/**
	 * Pointer down on a tile: selection now, drag if it moves, open on
	 * double-click. The click handler lives on the drag *session*
	 * (`onClickOnly`), so a press that becomes a drag never also selects
	 * twice or opens.
	 */
	private onTilePointerDown( event: PointerEvent, tile: HTMLElement ): void {
		if ( event.button !== 0 ) {
			return;
		}

		const id = Number( tile.dataset.id );
		const item = this.byId.get( id );

		if ( ! item ) {
			return;
		}

		const additive = event.metaKey || event.ctrlKey;
		const ranged = event.shiftKey;

		// Selection semantics resolve on *press*, like every desktop's grid —
		// except a press inside an existing multi-selection, which must not
		// collapse it before a drag has had the chance to carry it.
		const insideSelection = this.selection.has( id ) && this.selection.count() > 1;

		if ( ranged ) {
			this.selection.range( id );
		} else if ( additive ) {
			this.selection.toggle( id );
		} else if ( ! insideSelection ) {
			this.selection.select( id );
		}

		this.paintSelection();
		this.focusedId = id;
		this.delegate.onSelection( this.selection.ids() );

		const set = this.selection
			.dragSet( id )
			.map( ( memberId ) => this.byId.get( memberId ) )
			.filter( ( member ): member is MediaItem => !! member );

		this.dnd.start( {
			payload: attachmentPayload( item, set, tile, event ),
			origin: event,
			onClickOnly: () => {
				// The press already selected; a plain click inside a
				// multi-selection collapses to the clicked tile, which the
				// press deferred in case this became a drag.
				if ( ! additive && ! ranged && insideSelection ) {
					this.selection.select( id );
					this.paintSelection();
					this.delegate.onSelection( this.selection.ids() );
				}
			},
		} );
	}

	private onKeydown( event: KeyboardEvent ): void {
		const columns = this.columnCount();
		const order = this.items.map( ( item ) => item.id );

		if ( order.length === 0 ) {
			return;
		}

		const currentIndex = Math.max( 0, order.indexOf( this.focusedId ) );
		let nextIndex = -1;

		switch ( event.key ) {
			case 'ArrowRight':
				nextIndex = Math.min( order.length - 1, currentIndex + 1 );
				break;
			case 'ArrowLeft':
				nextIndex = Math.max( 0, currentIndex - 1 );
				break;
			case 'ArrowDown':
				nextIndex = Math.min( order.length - 1, currentIndex + columns );
				break;
			case 'ArrowUp':
				nextIndex = Math.max( 0, currentIndex - columns );
				break;
			case 'a':
				if ( event.metaKey || event.ctrlKey ) {
					event.preventDefault();
					event.stopPropagation();
					this.selectAll();
				}

				return;
			case 'Enter': {
				const item = this.byId.get( this.focusedId );

				if ( item ) {
					event.preventDefault();
					event.stopPropagation();
					this.delegate.onOpen( item );
				}

				return;
			}
			default:
				return;
		}

		event.preventDefault();
		event.stopPropagation();

		const nextId = order[ nextIndex ];

		this.focusedId = nextId;

		if ( event.shiftKey ) {
			this.selection.range( nextId );
		} else {
			this.selection.select( nextId );
		}

		this.paintSelection();
		this.delegate.onSelection( this.selection.ids() );
		this.tiles.get( nextId )?.scrollIntoView( { block: 'nearest' } );
	}

	/** How many tiles share a row right now, for arrow-key geometry. */
	private columnCount(): number {
		const first = this.list.firstElementChild as HTMLElement | null;

		if ( ! first ) {
			return 1;
		}

		const tileWidth = first.offsetWidth || 1;
		const listWidth = this.list.clientWidth || tileWidth;

		return Math.max( 1, Math.floor( listWidth / tileWidth ) );
	}

	private paintSelection(): void {
		for ( const [ id, tile ] of this.tiles ) {
			const selected = this.selection.has( id );

			tile.classList.toggle( 'is-selected', selected );
			tile.setAttribute( 'aria-selected', selected ? 'true' : 'false' );
		}
	}

	public destroy(): void {
		if ( this.keyHandler ) {
			window.removeEventListener( 'keydown', this.keyHandler, true );
			this.keyHandler = null;
		}

		this.observer?.disconnect();
		this.list.remove();
		this.sentinel.remove();
		this.tiles.clear();
	}
}
