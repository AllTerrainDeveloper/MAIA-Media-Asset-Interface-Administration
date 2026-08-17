/**
 * The Media Viewer: a picture, full bleed, and everything about it one key away.
 *
 * Minimal on the surface — a dark stage, a slim toolbar, the photo — and
 * loaded underneath: wheel/pinch zoom with drag panning, fit/1:1 toggle,
 * ← / → walks the library by date, and the ⓘ drawer is the *whole*
 * inspector (editable fields, EXIF, usage, versions with rollback, convert,
 * rotate, replace, download-as, AI alt text). Core's attachment screen is a
 * form with a thumbnail; this is the opposite.
 *
 * One instance that retargets: opening another image reuses the window,
 * exactly like Preview on a Mac. The subject arrives via open-time `params`
 * (session-restored, so a reload brings the same photo back), and
 * retargeting rides the `atme.view` broadcast.
 */

import { fetchMediaItem, fetchNeighbors, getShell } from './api';
import { buttonControl } from './os-ui';
import { mountInspector, type Inspector } from './inspector';
import { EXPLORER_TYPE, mediaIdentity, setIdentity } from './relations';
import { fetchUsage, getConfig, onMediaChanged } from './api';
import { VIEW_TOPIC, VIEWER_WINDOW_ID } from './view-open';
import type { MediaItem } from './types';

export type Teardown = () => void;

/** Zoom stops for the +/− buttons; 'fit' floats between them. */
const ZOOM_STOPS = [ 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8 ];

/** The next stop up or down from an arbitrary scale. */
export function nextZoomStop( scale: number, direction: 1 | -1 ): number {
	if ( direction === 1 ) {
		return ZOOM_STOPS.find( ( stop ) => stop > scale + 0.001 ) ?? ZOOM_STOPS[ ZOOM_STOPS.length - 1 ];
	}

	return [ ...ZOOM_STOPS ].reverse().find( ( stop ) => stop < scale - 0.001 ) ?? ZOOM_STOPS[ 0 ];
}

/** Scale that fits a media box inside a stage, never enlarging past 1:1. */
export function fitScale( mediaW: number, mediaH: number, stageW: number, stageH: number ): number {
	if ( mediaW <= 0 || mediaH <= 0 || stageW <= 0 || stageH <= 0 ) {
		return 1;
	}

	return Math.min( 1, stageW / mediaW, stageH / mediaH );
}

export function mountViewer( root: HTMLElement, params: Record< string, unknown > = {} ): Teardown {
	const app = new ViewerApp( root );
	const teardowns: Teardown[] = [ () => app.destroy() ];

	// Whichever id reaches us first wins; later broadcasts retarget.
	const parked = ( window as unknown as { __atmeView?: number } ).__atmeView;
	const initial = Number( params.mediaId ?? parked ?? 0 );

	delete ( window as unknown as { __atmeView?: number } ).__atmeView;

	if ( initial > 0 ) {
		void app.show( initial );
	}

	const shell = getShell();

	if ( shell?.subscribe ) {
		teardowns.push(
			shell.subscribe( VIEW_TOPIC, ( payload ) => {
				const id = Number( ( payload as { id?: number } )?.id );

				if ( id > 0 ) {
					void app.show( id );
				}
			} )
		);
	}

	teardowns.push(
		onMediaChanged( ( ids ) => {
			if ( app.currentId() > 0 && ids.includes( app.currentId() ) ) {
				void app.show( app.currentId(), true );
			}
		} )
	);

	return () => {
		for ( const teardown of teardowns.splice( 0 ) ) {
			teardown();
		}
	};
}

class ViewerApp {
	private readonly root: HTMLElement;
	private readonly stage: HTMLElement;
	private readonly toolbar: HTMLElement;
	private readonly caption: HTMLElement;
	private readonly drawer: HTMLElement;
	private inspector: Inspector | null = null;
	private item: MediaItem | null = null;
	private neighbors: { prev: MediaItem | null; next: MediaItem | null } = { prev: null, next: null };
	private epoch = 0;

	/* Zoom state. 'fit' recomputes on resize; a number is an absolute scale. */
	private zoom: 'fit' | number = 'fit';
	private panX = 0;
	private panY = 0;
	private mediaW = 0;
	private mediaH = 0;
	private mediaEl: HTMLElement | null = null;
	private zoomLabel: HTMLElement | null = null;
	private drawerAuto = true;
	private navPrev: HTMLElement | null = null;
	private navNext: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;

	constructor( root: HTMLElement ) {
		this.root = root;
		root.classList.add( 'atme-viewer' );

		this.toolbar = document.createElement( 'div' );
		this.toolbar.className = 'atme-viewer__toolbar';

		this.stage = document.createElement( 'div' );
		this.stage.className = 'atme-viewer__stage';

		this.caption = document.createElement( 'div' );
		this.caption.className = 'atme-viewer__caption';

		this.drawer = document.createElement( 'aside' );
		this.drawer.className = 'atme-viewer__drawer';
		this.drawer.hidden = true;

		const main = document.createElement( 'div' );

		main.className = 'atme-viewer__main';
		main.appendChild( this.toolbar );
		main.appendChild( this.stage );
		main.appendChild( this.caption );

		root.appendChild( main );
		root.appendChild( this.drawer );

		this.buildToolbar();
		this.buildStageNav();
		this.wireStage();
		this.wireKeyboard();

		this.resizeObserver =
			typeof ResizeObserver !== 'undefined'
				? new ResizeObserver( () => this.applyZoom() )
				: null;
		this.resizeObserver?.observe( this.stage );
	}

	public currentId(): number {
		return this.item?.id ?? 0;
	}

	/* ------------------------------------------------------------------ *
	 * Loading and painting.
	 * ------------------------------------------------------------------ */

	public async show( id: number, keepZoom = false ): Promise< void > {
		const thisEpoch = ++this.epoch;

		try {
			const item = await fetchMediaItem( id );

			if ( thisEpoch !== this.epoch ) {
				return;
			}

			this.item = item;

			if ( ! keepZoom ) {
				this.zoom = 'fit';
				this.panX = 0;
				this.panY = 0;
			}

			this.paintStage();
			this.paintCaption();
			this.announce();

			// The info drawer is company, not an opt-in: it opens with the
			// first photo and stays until the reader dismisses it.
			if ( this.drawerAuto && this.drawer.hidden ) {
				this.toggleDrawer();
			}

			// Own the keyboard from the first frame: without focus here the
			// shell's desktop-level arrow bindings switch Spaces instead of
			// flipping photos.
			this.root.focus( { preventScroll: true } );

			if ( ! this.drawer.hidden ) {
				this.inspector?.show( item );
			}

			// Title follows the photo, like any document window.
			getShell()?.windowManager?.getById?.( VIEWER_WINDOW_ID )?.setTitle?.(
				item.title || `Media #${ item.id }`
			);

			// Neighbors resolve in the background; arrows light up when known.
			this.neighbors = { prev: null, next: null };
			this.paintNav();
			void fetchNeighbors( item ).then( ( neighbors ) => {
				if ( thisEpoch === this.epoch ) {
					this.neighbors = neighbors;
					this.paintNav();
				}
			} );
		} catch {
			if ( thisEpoch === this.epoch ) {
				this.stage.textContent = '';

				const gone = document.createElement( 'div' );

				gone.className = 'atme-viewer__gone';
				gone.textContent = 'This media item is gone.';
				this.stage.appendChild( gone );
			}
		}
	}

	private paintStage(): void {
		const item = this.item;

		if ( ! item ) {
			return;
		}

		this.stage.querySelectorAll( '.atme-viewer__media, .atme-viewer__gone' ).forEach( ( el ) => el.remove() );
		this.mediaEl = null;
		this.mediaW = 0;
		this.mediaH = 0;

		if ( 'image' === item.kind ) {
			const img = document.createElement( 'img' );

			img.className = 'atme-viewer__media';
			img.src = item.url;
			img.alt = item.alt;
			img.draggable = false;
			img.addEventListener( 'load', () => {
				this.mediaW = img.naturalWidth;
				this.mediaH = img.naturalHeight;
				this.applyZoom();
				this.paintCaption();
			} );
			this.stage.appendChild( img );
			this.mediaEl = img;
		} else if ( 'video' === item.kind ) {
			const video = document.createElement( 'video' );

			video.className = 'atme-viewer__media atme-viewer__media--intrinsic';
			video.src = item.url;
			video.controls = true;
			video.autoplay = true;
			this.stage.appendChild( video );
			this.mediaEl = video;
		} else if ( 'audio' === item.kind ) {
			const audio = document.createElement( 'audio' );

			audio.className = 'atme-viewer__media atme-viewer__media--intrinsic';
			audio.src = item.url;
			audio.controls = true;
			this.stage.appendChild( audio );
			this.mediaEl = audio;
		} else if ( 'application/pdf' === item.mime ) {
			const frame = document.createElement( 'iframe' );

			frame.className = 'atme-viewer__media atme-viewer__media--frame';
			frame.src = item.url;
			frame.title = item.title;
			this.stage.appendChild( frame );
			this.mediaEl = frame;
		} else {
			const chip = document.createElement( 'div' );

			chip.className = 'atme-viewer__media atme-viewer__media--intrinsic atme-viewer__filechip';

			const icon = document.createElement( 'span' );

			icon.className = 'dashicons dashicons-media-default';
			chip.appendChild( icon );

			const name = document.createElement( 'span' );

			name.textContent = item.url.split( '/' ).pop() ?? item.title;
			chip.appendChild( name );
			this.stage.appendChild( chip );
			this.mediaEl = chip;
		}

		this.applyZoom();
	}

	/** Applies the current zoom/pan to an image; other kinds size naturally. */
	private applyZoom(): void {
		const img = this.mediaEl;

		if ( ! img || ! this.item || 'image' !== this.item.kind || this.mediaW === 0 ) {
			this.zoomLabel && ( this.zoomLabel.textContent = '' );

			return;
		}

		const stageW = this.stage.clientWidth - 24;
		const stageH = this.stage.clientHeight - 24;
		const scale = 'fit' === this.zoom ? fitScale( this.mediaW, this.mediaH, stageW, stageH ) : this.zoom;

		// Fit mode centers and forgets the pan; explicit zoom keeps it.
		if ( 'fit' === this.zoom ) {
			this.panX = 0;
			this.panY = 0;
		}

		img.style.width = `${ this.mediaW * scale }px`;
		img.style.height = `${ this.mediaH * scale }px`;
		img.style.transform = `translate(${ this.panX }px, ${ this.panY }px)`;
		img.classList.toggle( 'is-pannable', 'fit' !== this.zoom );

		if ( this.zoomLabel ) {
			this.zoomLabel.textContent = `${ Math.round( scale * 100 ) }%`;
		}
	}

	private currentScale(): number {
		if ( 'fit' !== this.zoom ) {
			return this.zoom;
		}

		return fitScale( this.mediaW, this.mediaH, this.stage.clientWidth - 24, this.stage.clientHeight - 24 );
	}

	private paintCaption(): void {
		const item = this.item;

		if ( ! item ) {
			this.caption.textContent = '';

			return;
		}

		const parts = [ item.title || `#${ item.id }` ];

		if ( this.mediaW > 0 ) {
			parts.push( `${ this.mediaW } × ${ this.mediaH }` );
		}

		parts.push( item.mime );
		this.caption.textContent = parts.join( '  ·  ' );
	}

	/** The viewer window joins the photo's relations group. */
	private announce(): void {
		const item = this.item;

		if ( ! item ) {
			return;
		}

		const libraryRoot = { type: EXPLORER_TYPE, id: 'library' };

		fetchUsage( item.id )
			.then( ( usage ) => {
				if ( this.item?.id === item.id ) {
					setIdentity( this.root, mediaIdentity( item, usage, getConfig().adminUrl, libraryRoot ) );
				}
			} )
			.catch( () => setIdentity( this.root, mediaIdentity( item, [], getConfig().adminUrl, libraryRoot ) ) );
	}

	/* ------------------------------------------------------------------ *
	 * Chrome.
	 * ------------------------------------------------------------------ */

	private buildToolbar(): void {
		const zoomOut = buttonControl( {
			label: '−',
			className: 'atme-button atme-button--small',
			onClick: () => this.setZoom( nextZoomStop( this.currentScale(), -1 ) ),
		} );

		const zoomIn = buttonControl( {
			label: '+',
			className: 'atme-button atme-button--small',
			onClick: () => this.setZoom( nextZoomStop( this.currentScale(), 1 ) ),
		} );

		const fit = buttonControl( {
			label: 'Fit',
			className: 'atme-button atme-button--small',
			onClick: () => this.setZoom( 'fit' ),
		} );

		const oneToOne = buttonControl( {
			label: '1:1',
			className: 'atme-button atme-button--small',
			onClick: () => this.setZoom( 1 ),
		} );

		this.zoomLabel = document.createElement( 'span' );
		this.zoomLabel.className = 'atme-viewer__zoomlabel';

		const spacer = document.createElement( 'div' );

		spacer.className = 'atme-viewer__spacer';

		const info = buttonControl( {
			label: 'ⓘ Info',
			className: 'atme-button atme-button--small',
			onClick: () => this.toggleDrawer(),
		} );

		const openLibrary = buttonControl( {
			label: 'Show in library',
			className: 'atme-button atme-button--small',
			onClick: () => {
				const shell = getShell();
				const id = this.item?.id ?? 0;

				if ( id > 0 ) {
					( window as unknown as { __atmeReveal?: number } ).__atmeReveal = id;
					shell?.openWindow?.( 'allterrain-media-explorer', { source: 'atme-viewer' } );
					shell?.broadcast?.( 'atme.reveal', { id } );
				}
			},
		} );

		for ( const el of [ zoomOut, this.zoomLabel, zoomIn, fit, oneToOne, spacer, openLibrary, info ] ) {
			this.toolbar.appendChild( el );
		}
	}

	private buildStageNav(): void {
		const make = ( direction: -1 | 1 ): HTMLElement => {
			const button = document.createElement( 'button' );

			button.type = 'button';
			button.className = `atme-viewer__nav atme-viewer__nav--${ direction === -1 ? 'prev' : 'next' }`;
			button.setAttribute( 'aria-label', direction === -1 ? 'Newer item' : 'Older item' );
			button.textContent = direction === -1 ? '‹' : '›';
			button.addEventListener( 'click', () => this.step( direction ) );
			this.stage.appendChild( button );

			return button;
		};

		this.navPrev = make( -1 );
		this.navNext = make( 1 );
		this.paintNav();
	}

	private paintNav(): void {
		this.navPrev?.toggleAttribute( 'hidden', ! this.neighbors.prev );
		this.navNext?.toggleAttribute( 'hidden', ! this.neighbors.next );
	}

	private step( direction: -1 | 1 ): void {
		const target = direction === -1 ? this.neighbors.prev : this.neighbors.next;

		if ( target ) {
			void this.show( target.id );
		}
	}

	private setZoom( zoom: 'fit' | number ): void {
		this.zoom = zoom;
		this.applyZoom();
	}

	private toggleDrawer(): void {
		if ( this.drawer.hidden ) {
			if ( ! this.inspector ) {
				this.inspector = mountInspector( this.drawer, {
					onChanged: () => {
						if ( this.item ) {
							void this.show( this.item.id, true );
						}
					},
					onDeleted: () => {
						const next = this.neighbors.next ?? this.neighbors.prev;

						if ( next ) {
							void this.show( next.id );
						} else {
							this.stage.textContent = '';
							this.caption.textContent = '';
						}

						this.drawer.hidden = true;
					},
					onClose: () => {
						this.drawer.hidden = true;
					},
				} );
			}

			this.drawer.hidden = false;

			if ( this.item ) {
				this.inspector.show( this.item );
			}
		} else {
			this.drawer.hidden = true;
			// The reader closed it; stop reopening on every navigation.
			this.drawerAuto = false;
		}
	}

	/* ------------------------------------------------------------------ *
	 * Input.
	 * ------------------------------------------------------------------ */

	private wireStage(): void {
		// Wheel zooms toward the pointer; trackpad pinch arrives as
		// ctrl+wheel and takes the same path.
		this.stage.addEventListener(
			'wheel',
			( event ) => {
				if ( ! this.item || 'image' !== this.item.kind || this.mediaW === 0 ) {
					return;
				}

				event.preventDefault();

				const before = this.currentScale();
				const factor = Math.exp( -event.deltaY * ( event.ctrlKey ? 0.01 : 0.002 ) );
				const scale = Math.min( 8, Math.max( 0.05, before * factor ) );

				this.zoom = scale;
				this.applyZoom();
			},
			{ passive: false }
		);

		// Drag pans while zoomed in.
		let panning = false;
		let startX = 0;
		let startY = 0;
		let originX = 0;
		let originY = 0;

		this.stage.addEventListener( 'pointerdown', ( event ) => {
			// Any press inside the stage claims the keyboard for the viewer.
			this.root.focus( { preventScroll: true } );

			if ( 'fit' === this.zoom || ! this.mediaEl || event.button !== 0 ) {
				return;
			}

			panning = true;
			startX = event.clientX;
			startY = event.clientY;
			originX = this.panX;
			originY = this.panY;
			this.stage.setPointerCapture( event.pointerId );
		} );

		this.stage.addEventListener( 'pointermove', ( event ) => {
			if ( panning ) {
				this.panX = originX + ( event.clientX - startX );
				this.panY = originY + ( event.clientY - startY );
				this.applyZoom();
			}
		} );

		const endPan = () => {
			panning = false;
		};

		this.stage.addEventListener( 'pointerup', endPan );
		this.stage.addEventListener( 'pointercancel', endPan );

		// Double-click flips between fit and 1:1 — the Preview reflex.
		this.stage.addEventListener( 'dblclick', ( event ) => {
			if ( ( event.target as HTMLElement ).closest( '.atme-viewer__nav' ) ) {
				return;
			}

			this.setZoom( 'fit' === this.zoom ? 1 : 'fit' );
		} );
	}

	private keyHandler: ( ( event: KeyboardEvent ) => void ) | null = null;

	private wireKeyboard(): void {
		this.root.tabIndex = 0;

		// Window-level capture, not a listener on the root: the shell binds
		// bare arrow keys to Space switching with a *document*-capture
		// listener, and in the capture phase Window fires before Document —
		// the only place a later-loaded plugin can win its own keys back.
		this.keyHandler = ( event: KeyboardEvent ) => {
			if ( event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ) {
				return;
			}

			const target = event.target as HTMLElement | null;

			if ( ! target || ! this.root.contains( target ) ) {
				return;
			}

			// Typing in the drawer's fields must never flip photos.
			if ( target.closest( '.atme-viewer__drawer' ) ) {
				return;
			}

			const claim = () => {
				event.preventDefault();
				event.stopPropagation();
			};

			switch ( event.key ) {
				case 'ArrowLeft':
					claim();
					this.step( -1 );
					break;
				case 'ArrowRight':
					claim();
					this.step( 1 );
					break;
				case 'ArrowUp':
				case 'ArrowDown':
					// Unused here, but claimed anyway — ↓ while looking at a
					// photo must not hide every window on the desktop.
					claim();
					break;
				case '+':
				case '=':
					claim();
					this.setZoom( nextZoomStop( this.currentScale(), 1 ) );
					break;
				case '-':
					claim();
					this.setZoom( nextZoomStop( this.currentScale(), -1 ) );
					break;
				case '0':
					claim();
					this.setZoom( 'fit' );
					break;
				case '1':
					claim();
					this.setZoom( 1 );
					break;
				case 'i':
				case 'I':
					claim();
					this.toggleDrawer();
					break;
			}
		};

		window.addEventListener( 'keydown', this.keyHandler, true );
	}

	public destroy(): void {
		if ( this.keyHandler ) {
			window.removeEventListener( 'keydown', this.keyHandler, true );
			this.keyHandler = null;
		}

		this.resizeObserver?.disconnect();
		this.inspector?.destroy();
		this.inspector = null;
		this.root.textContent = '';
	}
}
