/**
 * The explorer itself: toolbar, sidebar, grid, inspector, status bar.
 *
 * One mount, every host. The app owns the library state — the current query,
 * the loaded pages, the selection — and delegates painting to the grid and
 * the inspector. Everything the user does funnels into `runQuery()` or a
 * verb in `api.ts`, and everything any *other* window does arrives through
 * the change topic and repaints the same way.
 */

import {
	convertMedia,
	createCollection,
	createFolder,
	deleteCollection,
	deleteFolder,
	deleteMedia,
	fetchCollections,
	fetchDuplicates,
	fetchFolders,
	fetchMedia,
	fetchMediaByIds,
	fetchMediaItem,
	fetchUsage,
	fileIntoFolder,
	getConfig,
	getShell,
	onMediaChanged,
	uploadMedia,
	type Collection,
} from './api';
import type { DragPayload, Folder, LibraryQuery, MediaItem } from './types';
import { entitiesIn, isDesktopPayload } from './desktop-drops';
import { mountQuickLook, type QuickLook } from './quicklook';
import { mountWizard, type Wizard } from './wizard';
import { MediaGrid } from './grid';
import { mountInspector, type Inspector } from './inspector';
import { getDragManager } from './dnd';
import { buttonControl, ensureComponents, selectControl, textControl } from './os-ui';
import { libraryIdentity, setIdentity } from './relations';
import { openViewer } from './view-open';
import { createNameForm, type NameForm } from './name-form';

export type Teardown = () => void;

/** The topic the eager shell bundle asks a window to reveal an item on. */
export const REVEAL_TOPIC = 'atme.reveal';

/** The smart views the sidebar offers. Server-side ones filter in REST. */
const SMART_VIEWS: Array< { slug: string; label: string; icon: string } > = [
	{ slug: '', label: 'All media', icon: 'dashicons-format-gallery' },
	{ slug: 'unattached', label: 'Unattached', icon: 'dashicons-editor-unlink' },
	{ slug: 'unfiled', label: 'Unfiled', icon: 'dashicons-portfolio' },
	{ slug: 'missing-alt', label: 'Missing alt text', icon: 'dashicons-warning' },
	{ slug: 'converted', label: 'Converted copies', icon: 'dashicons-controls-repeat' },
	{ slug: 'duplicates', label: 'Duplicates', icon: 'dashicons-images-alt' },
];

const KINDS: Array< { value: string; label: string } > = [
	{ value: '', label: 'All types' },
	{ value: 'image', label: 'Images' },
	{ value: 'video', label: 'Video' },
	{ value: 'audio', label: 'Audio' },
	{ value: 'application', label: 'Documents' },
];

const DEFAULT_QUERY: LibraryQuery = {
	search: '',
	kind: '',
	folder: 0,
	view: '',
	orderby: 'date',
	order: 'desc',
};

/** Mounts the explorer into the window template's root. */
export type MountedMediaApp = Teardown & { retarget: ( params: Record< string, unknown > ) => void };

export function mountExplorer( root: HTMLElement, params: Record< string, unknown > = {} ): MountedMediaApp {
	const app = new ExplorerApp( root );
	app.retarget( params );

	app.boot();

	return Object.assign( () => app.destroy(), { retarget: ( next: Record< string, unknown > ) => app.retarget( next ) } );
}

class ExplorerApp {
	private readonly root: HTMLElement;
	private disposed = false;
	private booted = false;
	private target: Record< string, unknown > = {};
	private readonly teardowns: Teardown[] = [];
	private grid: MediaGrid | null = null;
	private inspector: Inspector | null = null;
	private query: LibraryQuery = { ...DEFAULT_QUERY };
	private page = 0;
	private totalPages = 1;
	private total = 0;
	private loading = false;
	private queryEpoch = 0;
	private folders: Folder[] = [];
	private statusEl: HTMLElement | null = null;
	private sidebarEl: HTMLElement | null = null;
	private openItemId = 0;
	private collections: Collection[] = [];
	private quickLook: QuickLook | null = null;
	private wizard: Wizard | null = null;
	private wizardOpen = false;
	private bulkBar: HTMLElement | null = null;
	private folderDropOffs: Array< () => void > = [];
	private readonly folderSaves = new Map< number, number >();
	private filingStatusEl: HTMLElement | null = null;
	private readonly deletingFolders = new Set< number >();
	private nameForm: NameForm | null = null;
	private nameFormKind: 'folder' | 'collection' = 'folder';

	constructor( root: HTMLElement ) {
		this.root = root;
	}

	/** Targets this instance, including requests received while components load. */
	public retarget( params: Record< string, unknown > ): void {
		this.target = params;
		if ( ! this.booted || this.disposed ) {
			return;
		}
		const id = Number( params.mediaId ?? 0 );
		if ( Number.isSafeInteger( id ) && id > 0 ) {
			void this.revealItem( id );
		}
		if ( params.wizard === true ) {
			this.openWizard();
		}
	}

	public async boot(): Promise< void > {
		// The shell's controls, before first paint where possible; the
		// helpers in os-ui fall back to native controls regardless.
		await ensureComponents().catch( () => false );
		if ( this.disposed ) {
			return;
		}

		const loading = this.root.querySelector< HTMLElement >( '[data-atme-loading]' );
		const frame = this.root.querySelector< HTMLElement >( '[data-atme-frame]' );
		const sidebar = this.root.querySelector< HTMLElement >( '[data-atme-sidebar]' );
		const main = this.root.querySelector< HTMLElement >( '[data-atme-main]' );
		const inspectorHost = this.root.querySelector< HTMLElement >( '[data-atme-inspector]' );

		if ( ! frame || ! sidebar || ! main || ! inspectorHost ) {
			return;
		}

		loading?.setAttribute( 'hidden', '' );
		frame.removeAttribute( 'hidden' );

		this.sidebarEl = sidebar;

		// Main column: toolbar over grid over status bar.
		const toolbar = document.createElement( 'div' );

		toolbar.className = 'atme-toolbar';
		main.appendChild( toolbar );
		this.buildToolbar( toolbar );

		const gridHost = document.createElement( 'div' );

		gridHost.className = 'atme-gridhost';
		main.appendChild( gridHost );

		const filingStatus = document.createElement( 'div' );

		filingStatus.className = 'atme-filing-status';
		filingStatus.setAttribute( 'role', 'status' );
		filingStatus.setAttribute( 'aria-live', 'polite' );
		filingStatus.setAttribute( 'aria-atomic', 'true' );
		main.appendChild( filingStatus );
		this.filingStatusEl = filingStatus;

		const status = document.createElement( 'div' );

		status.className = 'atme-status';
		main.appendChild( status );
		this.statusEl = status;

		this.grid = new MediaGrid( gridHost, getDragManager(), {
			// Double-click / Enter is "look at it" — the viewer window.
			// The inspector stays one ⓘ (or `i`) away.
			onOpen: ( item ) => openViewer( item.id ),
			onSelection: ( ids ) => this.onSelection( ids ),
			onNeedMore: () => void this.loadMore(),
		} );

		this.inspector = mountInspector( inspectorHost, {
			onChanged: ( item ) => this.grid?.patchItems( [ item ] ),
			onDeleted: ( id ) => {
				this.grid?.removeItems( [ id ] );
				this.total = Math.max( 0, this.total - 1 );
				this.openItemId = 0;
				this.inspector?.showEmpty();
				this.paintStatus();
			},
			onClose: () => this.closeInspector(),
		} );

		// Present by default: the panel rests on an empty state until the
		// first click fills it. Hiding it stays one ⓘ away.
		inspectorHost.removeAttribute( 'hidden' );
		this.inspector.showEmpty();

		this.wireUploadDrop( frame );
		this.wireGridDrops( gridHost );
		this.wireQuickLook( main, gridHost );
		this.wizard = mountWizard(
			main,
			() => {
				void this.runQuery();
				void this.refreshFolders();
			},
			() => {
				this.wizardOpen = false;
				this.paintSidebar();
			}
		);
		this.announceIdentity( 0 );

		// Other windows' writes repaint this one.
		this.teardowns.push(
			onMediaChanged( ( ids ) => void this.onExternalChange( ids ) )
		);

		// The eager bundle's "reveal" verb.
		const shell = getShell();

		if ( shell?.subscribe ) {
			this.teardowns.push(
				shell.subscribe( REVEAL_TOPIC, ( payload ) => {
					const id = Number( ( payload as { id?: number } )?.id );

					if ( id > 0 ) {
						void this.revealItem( id );
					}
				} )
			);
		}

		if ( shell?.subscribe ) {
			this.teardowns.push( shell.subscribe( 'atme.wizard', () => this.openWizard() ) );
		}

		this.booted = true;
		this.retarget( this.target );

		await Promise.all( [ this.runQuery(), this.refreshFolders(), this.refreshCollections() ] );
	}

	/**
	 * Spacebar opens Quick Look on the selection; arrows walk from there.
	 */
	/** ⓘ / `i`: hides or restores the always-on info panel. */
	private toggleInspectorForSelection(): void {
		const host = this.root.querySelector( '[data-atme-inspector]' );

		if ( host && ! host.hasAttribute( 'hidden' ) ) {
			this.closeInspector();

			return;
		}

		host?.removeAttribute( 'hidden' );

		const selected = this.grid?.selectedItems() ?? [];

		if ( selected[ 0 ] ) {
			this.openItem( selected[ 0 ] );
		} else {
			this.inspector?.showEmpty();
		}
	}

	private wireQuickLook( main: HTMLElement, gridHost: HTMLElement ): void {
		this.quickLook = mountQuickLook( main, ( direction ) => {
			const items = this.grid?.getItems() ?? [];
			const selected = this.grid?.selectedIds() ?? [];
			const currentId = selected[ 0 ] ?? 0;
			const index = items.findIndex( ( item ) => item.id === currentId );
			const next = items[ index + direction ];

			if ( next ) {
				this.grid?.reveal( next.id );
			}

			return next ?? null;
		} );

		gridHost.addEventListener( 'keydown', ( event ) => {
			if ( ( 'i' === event.key || 'I' === event.key ) && ! this.quickLook?.isOpen() ) {
				event.preventDefault();
				this.toggleInspectorForSelection();

				return;
			}

			if ( event.key !== ' ' || this.quickLook?.isOpen() ) {
				return;
			}

			const selected = this.grid?.selectedItems() ?? [];

			if ( selected.length > 0 ) {
				event.preventDefault();
				this.quickLook?.open( selected[ 0 ] );
			}
		} );
	}

	/**
	 * Tiles dragged in from WP Explorer or the wallpaper file into the
	 * current folder — the drop that makes a folder feel like a place.
	 */
	private wireGridDrops( gridHost: HTMLElement ): void {
		const off = getDragManager().registerDropTarget( {
			id: 'allterrain-media-explorer/grid',
			element: gridHost,
			accept: ( payload: DragPayload ) => {
				// Only payloads from *outside* this window mean anything here;
				// a tile lifted from this very grid is not a filing gesture.
				if ( ! isDesktopPayload( payload ) || gridHost.contains( payload.source ) ) {
					return false;
				}

				return entitiesIn( payload ).some( ( entity ) => entity.kind === 'attachment' );
			},
			acceptLabel: this.query.folder > 0 ? 'File here' : 'Reveal in explorer',
			onDrop: ( session ) => {
				const ids = entitiesIn( session.payload )
					.filter( ( entity ) => entity.kind === 'attachment' )
					.map( ( entity ) => Number( entity.ref ) )
					.filter( ( id ) => id > 0 );

				if ( ids.length === 0 ) {
					return;
				}

				if ( this.query.folder > 0 ) {
					return this.saveToFolder( ids, this.query.folder );
				} else {
					void this.revealItem( ids[ 0 ] );
				}
				return;
			},
		} );

		this.teardowns.push( off );
	}

	/* ------------------------------------------------------------------ *
	 * Toolbar and sidebar.
	 * ------------------------------------------------------------------ */

	private buildToolbar( toolbar: HTMLElement ): void {
		let debounce = 0;

		const search = textControl( {
			label: 'Search media',
			placeholder: 'Search media…',
			type: 'search',
			className: 'atme-toolbar__search',
			hideLabel: true,
			onInput: ( value ) => {
				window.clearTimeout( debounce );
				debounce = window.setTimeout( () => {
					this.query.search = value.trim();
					void this.runQuery();
				}, 250 );
			},
		} );

		search.classList.add( 'atme-toolbar__search' );
		toolbar.appendChild( search );

		toolbar.appendChild(
			selectControl( {
				label: 'Filter by type',
				value: this.query.kind,
				options: KINDS,
				className: 'atme-toolbar__kind',
				hideLabel: true,
				onChange: ( value ) => {
					this.query.kind = value;
					void this.runQuery();
				},
			} )
		);

		toolbar.appendChild(
			selectControl( {
				label: 'Sort',
				value: `${ this.query.orderby }:${ this.query.order }`,
				options: [
					{ value: 'date:desc', label: 'Newest first' },
					{ value: 'date:asc', label: 'Oldest first' },
					{ value: 'title:asc', label: 'Name A–Z' },
					{ value: 'title:desc', label: 'Name Z–A' },
				],
				className: 'atme-toolbar__sort',
				hideLabel: true,
				onChange: ( value ) => {
					const [ orderby, order ] = value.split( ':' ) as [ LibraryQuery[ 'orderby' ], LibraryQuery[ 'order' ] ];

					this.query.orderby = orderby;
					this.query.order = order;
					void this.runQuery();
				},
			} )
		);

		let layout: 'grid' | 'list' = 'grid';

		const layoutToggle = buttonControl( {
			label: 'List view',
			className: 'atme-button',
			onClick: () => {
				layout = 'grid' === layout ? 'list' : 'grid';
				this.grid?.setLayout( layout );
				layoutToggle.textContent = 'grid' === layout ? 'List view' : 'Grid view';
			},
		} );

		toolbar.appendChild( layoutToggle );

		toolbar.appendChild(
			buttonControl( {
				label: 'ⓘ Info',
				className: 'atme-button',
				onClick: () => this.toggleInspectorForSelection(),
			} )
		);

		const spacer = document.createElement( 'div' );

		spacer.className = 'atme-toolbar__spacer';
		toolbar.appendChild( spacer );

		if ( getConfig().canUpload ) {
			const picker = document.createElement( 'input' );

			picker.type = 'file';
			picker.multiple = true;
			picker.hidden = true;
			picker.addEventListener( 'change', () => {
				if ( picker.files?.length ) {
					void this.uploadFiles( Array.from( picker.files ) );
					picker.value = '';
				}
			} );

			toolbar.appendChild(
				buttonControl( {
					label: 'Upload',
					variant: 'primary',
					className: 'atme-button atme-button--primary',
					onClick: () => picker.click(),
				} )
			);
			toolbar.appendChild( picker );
		}
	}

	/**
	 * The wizard behaves like a sidebar tab: opening it marks its row
	 * active, and choosing any other row closes it and returns the library.
	 */
	private openWizard(): void {
		this.wizardOpen = true;
		this.wizard?.open();
		this.paintSidebar();
	}

	private leaveWizard(): void {
		if ( this.wizardOpen ) {
			// close() reports back through onClosed, which clears the flag
			// and repaints the sidebar.
			this.wizard?.close();
		}
	}

	private paintSidebar(): void {
		const sidebar = this.sidebarEl;

		if ( ! sidebar || this.disposed ) {
			return;
		}

		const restoreNameFocus = !! this.nameForm?.element.contains( document.activeElement );

		// Folder rows re-render, so yesterday's drop targets die with them.
		for ( const off of this.folderDropOffs.splice( 0 ) ) {
			off();
		}

		sidebar.textContent = '';

		const views = document.createElement( 'div' );

		views.className = 'atme-side__group';

		const viewsTitle = document.createElement( 'div' );

		viewsTitle.className = 'atme-side__title';
		viewsTitle.textContent = 'Library';
		views.appendChild( viewsTitle );

		for ( const view of SMART_VIEWS ) {
			views.appendChild(
				this.sideRow(
					view.label,
					view.icon,
					! this.wizardOpen && this.query.view === view.slug && this.query.folder === 0,
					() => {
						this.leaveWizard();
						this.query.view = view.slug;
						this.query.folder = 0;
						void this.runQuery();
						this.paintSidebar();
					}
				)
			);
		}

		sidebar.appendChild( views );

		const foldersGroup = document.createElement( 'div' );

		foldersGroup.className = 'atme-side__group';

		const foldersTitle = document.createElement( 'div' );

		foldersTitle.className = 'atme-side__title';
		foldersTitle.textContent = 'Folders';
		foldersGroup.appendChild( foldersTitle );

		const roots = this.folders.filter( ( folder ) => folder.parent === 0 );

		const paintLevel = ( level: Folder[], depth: number ) => {
			for ( const folder of level ) {
				const row = this.sideRow(
					folder.name,
					'dashicons-category',
					! this.wizardOpen && this.query.folder === folder.id,
					() => {
						this.leaveWizard();
						this.query.folder = folder.id;
						this.query.view = '';
						void this.runQuery();
						this.paintSidebar();
					},
					folder.count
				);

				row.dataset.folderId = String( folder.id );
				this.paintFolderSave( row, folder.id );
				row.style.paddingInlineStart = `${ 8 + depth * 16 }px`;
				foldersGroup.appendChild( row );

				// Every folder row is a drop target: drag tiles from the grid
				// (or from WP Explorer, or the wallpaper) onto it to file them.
				this.folderDropOffs.push(
					getDragManager().registerDropTarget( {
						id: `allterrain-media-explorer/folder-${ folder.id }`,
						element: row,
						accept: ( payload: DragPayload ) => {
							if ( this.deletingFolders.has( folder.id ) ) {
								return false;
							}
							if ( payload.type === 'shortcut' || payload.type === 'desktop-file' ) {
								return entitiesIn( payload ).some( ( entity ) => entity.kind === 'attachment' );
							}

							return false;
						},
						acceptLabel: `File into ${ folder.name }`,
						onEnter: () => row.classList.add( 'is-drop-target' ),
						onLeave: () => row.classList.remove( 'is-drop-target' ),
						onDrop: ( session ) => {
							row.classList.remove( 'is-drop-target' );

							const ids = entitiesIn( session.payload )
								.filter( ( entity ) => entity.kind === 'attachment' )
								.map( ( entity ) => Number( entity.ref ) )
								.filter( ( id ) => id > 0 );

							if ( ids.length === 0 ) {
								return;
							}

							return this.saveToFolder( ids, folder.id );
						},
					} )
				);

				paintLevel( this.folders.filter( ( child ) => child.parent === folder.id ), depth + 1 );
			}
		};

		paintLevel( roots, 0 );

		const newFolder = buttonControl( {
			label: '+ New top-level folder',
			className: 'atme-side__row',
			onClick: () => {
				this.showNewFolder();
			},
		} );

		newFolder.classList.add( 'atme-side__new' );
		foldersGroup.appendChild( newFolder );

		const selectedFolder = this.folders.find( ( folder ) => folder.id === this.query.folder );

		if ( selectedFolder ) {
			foldersGroup.appendChild( buttonControl( {
				label: '+ New subfolder',
				className: 'atme-side__row atme-side__new',
				onClick: () => this.showNewFolder( selectedFolder.id ),
			} ) );
			foldersGroup.appendChild( buttonControl( {
				label: 'Delete folder…',
				className: 'atme-side__row atme-side__new',
				onClick: () => void this.promptDeleteFolder( selectedFolder ),
			} ) );
		}

		if ( this.nameForm && this.nameFormKind === 'folder' ) {
			foldersGroup.appendChild( this.nameForm.element );
		}
		sidebar.appendChild( foldersGroup );

		/* Collections ---------------------------------------------------- */
		const collectionsGroup = document.createElement( 'div' );

		collectionsGroup.className = 'atme-side__group';

		const collectionsTitle = document.createElement( 'div' );

		collectionsTitle.className = 'atme-side__title';
		collectionsTitle.textContent = 'Collections';
		collectionsGroup.appendChild( collectionsTitle );

		for ( const collection of this.collections ) {
			const row = this.sideRow( collection.title, 'dashicons-star-filled', false, () => {
				this.leaveWizard();
				this.query = { ...DEFAULT_QUERY, ...collection.query };
				void this.runQuery();
				this.paintSidebar();
			} );

			// A quiet remove affordance on the row itself.
			row.addEventListener( 'contextmenu', ( event ) => {
				event.preventDefault();

				const shell = getShell();
				const remove = () =>
					void deleteCollection( collection.id ).then( () => void this.refreshCollections() );

				if ( shell?.confirm ) {
					void shell
						.confirm( {
							title: 'Remove collection',
							message: `Remove “${ collection.title }”? The media it lists is untouched.`,
							confirmLabel: 'Remove',
							danger: true,
						} )
						.then( ( yes ) => yes && remove() );
				}
			} );

			collectionsGroup.appendChild( row );
		}

		const saveCollection = buttonControl( {
			label: '+ Save current view',
			className: 'atme-side__row',
			onClick: () => {
				this.showSaveCollection();
			},
		} );

		saveCollection.classList.add( 'atme-side__new' );
		collectionsGroup.appendChild( saveCollection );

		if ( this.nameForm && this.nameFormKind === 'collection' ) {
			collectionsGroup.appendChild( this.nameForm.element );
		}
		sidebar.appendChild( collectionsGroup );

		/* Tools ----------------------------------------------------------- */
		const toolsGroup = document.createElement( 'div' );

		toolsGroup.className = 'atme-side__group';

		const toolsTitle = document.createElement( 'div' );

		toolsTitle.className = 'atme-side__title';
		toolsTitle.textContent = 'Tools';
		toolsGroup.appendChild( toolsTitle );

		toolsGroup.appendChild(
			this.sideRow( 'Optimization Wizard', 'dashicons-superhero', this.wizardOpen, () => this.openWizard() )
		);

		sidebar.appendChild( toolsGroup );
		if ( restoreNameFocus ) { this.nameForm?.focus(); }
	}

	/** Paints pending writes without replacing a focused row or its drop target. */
	private paintFolderSave( row: HTMLElement, folderId: number ): void {
		const deleting = this.deletingFolders.has( folderId );
		const saving = deleting || ( this.folderSaves.get( folderId ) ?? 0 ) > 0;

		row.classList.toggle( 'is-saving', saving );
		row.setAttribute( 'aria-busy', String( saving ) );
		row.querySelector( '.atme-side__saving' )?.remove();
		if ( saving ) {
			const label = document.createElement( 'span' );

			label.className = 'atme-side__saving';
			label.textContent = deleting ? 'Deleting…' : 'Saving…';
			row.appendChild( label );
		}
	}

	/** Keeps feedback visible until the write and refreshed folder contents settle. */
	private async saveToFolder( ids: number[], folderId: number ): Promise< void > {
		if ( this.disposed || this.deletingFolders.has( folderId ) ) {
			return;
		}
		const name = this.folders.find( ( folder ) => folder.id === folderId )?.name ?? 'folder';
		const items = `${ ids.length } item${ ids.length === 1 ? '' : 's' }`;
		const paint = () => {
			this.sidebarEl?.querySelectorAll< HTMLElement >( `[data-folder-id="${ folderId }"]` )
				.forEach( ( row ) => this.paintFolderSave( row, folderId ) );
		};
		const announce = ( message: string, failed = false ) => {
			if ( this.filingStatusEl ) {
				this.filingStatusEl.textContent = message;
				this.filingStatusEl.classList.toggle( 'is-error', failed );
			}
		};

		this.folderSaves.set( folderId, ( this.folderSaves.get( folderId ) ?? 0 ) + 1 );
		paint();
		announce( `Saving ${ items } into ${ name }…` );
		try {
			await fileIntoFolder( ids, folderId );
			if ( this.disposed ) {
				return;
			}
			await Promise.all( [
				this.refreshFolders(),
				...( this.query.folder > 0 || this.query.view === 'unfiled' ? [ this.runQuery() ] : [] ),
			] );
			if ( this.disposed ) {
				return;
			}
			const message = `Filed ${ items } into ${ name }.`;

			announce( message );
			getShell()?.showToast?.( { message } );
		} catch ( error ) {
			if ( this.disposed ) {
				return;
			}
			const message = `Could not file ${ items } into ${ name }. Try again.`;

			announce( message, true );
			getShell()?.notify?.( {
				title: message,
				body: error instanceof Error ? error.message : '',
				type: 'error',
			} );
		} finally {
			const remaining = ( this.folderSaves.get( folderId ) ?? 1 ) - 1;

			if ( remaining > 0 ) {
				this.folderSaves.set( folderId, remaining );
			} else {
				this.folderSaves.delete( folderId );
			}
			if ( ! this.disposed ) {
				paint();
			}
		}
	}

	/** Opens one persistent inline form; repainting the tree keeps its draft. */
	private showNameForm( kind: 'folder' | 'collection', opts: Omit< Parameters< typeof createNameForm >[ 0 ], 'onClose' > ): void {
		if ( this.disposed ) { return; }
		if ( this.nameForm?.busy ) { this.nameForm.focus(); return; }
		this.nameForm?.destroy();
		this.nameFormKind = kind;
		this.nameForm = createNameForm( { ...opts, onClose: () => {
			this.nameForm?.destroy();
			this.nameForm = null;
			this.paintSidebar();
			this.sidebarEl?.querySelector< HTMLElement >( '.atme-side__row.is-active' )?.focus();
		} } );
		this.paintSidebar();
		this.nameForm.focus();
	}

	private showNewFolder( parent = 0 ): void {
		if ( this.deletingFolders.has( parent ) ) { return; }
		const parentName = this.folders.find( ( folder ) => folder.id === parent )?.name;
		this.showNameForm( 'folder', {
			label: 'Folder name',
			destination: parent ? `Inside “${ parentName }”` : 'At the top level',
			submitLabel: 'Create folder',
			onSave: async ( name ) => {
				const created = await createFolder( name, parent );
				if ( this.disposed ) { return; }
				await this.refreshFolders();
				if ( this.disposed ) { return; }
				this.leaveWizard();
				this.query.folder = created.id;
				this.query.view = '';
				this.paintSidebar();
				await this.runQuery();
			},
		} );
	}

	/** Deletes the folder label, never its attachments or child folders. */
	private async promptDeleteFolder( folder: Folder ): Promise< void > {
		if ( this.disposed || this.deletingFolders.has( folder.id ) ) {
			return;
		}
		const shell = getShell();
		const message = `Delete “${ folder.name }”? Media files will stay in the library. Subfolders will move up one level.`;
		const confirmed = shell?.confirm
			? await shell.confirm( { title: 'Delete folder', message, confirmLabel: 'Delete folder', danger: true } )
			: false;

		if ( ! confirmed || this.disposed || this.deletingFolders.has( folder.id ) ) {
			return;
		}
		if ( this.folderSaves.has( folder.id ) ) {
			shell?.notify?.( { title: 'This folder is still saving. Try deleting it when saving finishes.' } );
			return;
		}
		this.deletingFolders.add( folder.id );
		if ( this.filingStatusEl ) {
			this.filingStatusEl.textContent = `Deleting “${ folder.name }”…`;
			this.filingStatusEl.classList.remove( 'is-error' );
		}
		this.paintSidebar();
		try {
			await deleteFolder( folder.id );
			if ( this.disposed ) {
				return;
			}
			// Keep the local tree coherent even if the follow-up read fails.
			this.folders = this.folders.filter( ( item ) => item.id !== folder.id )
				.map( ( item ) => item.parent === folder.id ? { ...item, parent: folder.parent } : item );
			if ( this.query.folder === folder.id ) {
				this.query.folder = folder.parent;
				this.query.view = '';
			}
			await this.refreshFolders();
			if ( this.disposed ) {
				return;
			}
			await this.runQuery();
			if ( ! this.disposed && this.filingStatusEl ) {
				this.filingStatusEl.textContent = `Deleted “${ folder.name }”. Media files were kept.`;
				this.filingStatusEl.classList.remove( 'is-error' );
			}
		} catch ( error ) {
			if ( ! this.disposed ) {
				if ( this.filingStatusEl ) {
					this.filingStatusEl.textContent = `Could not delete “${ folder.name }”. Try again.`;
					this.filingStatusEl.classList.add( 'is-error' );
				}
				shell?.notify?.( {
					title: 'Could not delete the folder',
					body: error instanceof Error ? error.message : '',
					type: 'error',
				} );
			}
		} finally {
			this.deletingFolders.delete( folder.id );
			this.paintSidebar();
		}
	}

	private showSaveCollection(): void {
		const query = { ...this.query };
		this.showNameForm( 'collection', {
			label: 'Collection name',
			destination: 'Save this library view',
			value: query.search || 'My collection',
			submitLabel: 'Save collection',
			onSave: async ( title ) => {
				await createCollection( title, query );
				if ( ! this.disposed ) { await this.refreshCollections(); }
			},
		} );
	}

	private async refreshCollections(): Promise< void > {
		try {
			this.collections = await fetchCollections();
		} catch {
			this.collections = [];
		}

		this.paintSidebar();
	}

	private sideRow( label: string, icon: string, active: boolean, onClick: () => void, count?: number ): HTMLElement {
		const row = document.createElement( 'button' );

		row.type = 'button';
		row.className = 'atme-side__row' + ( active ? ' is-active' : '' );

		const iconEl = document.createElement( 'span' );

		iconEl.className = `dashicons ${ icon }`;
		row.appendChild( iconEl );

		const labelEl = document.createElement( 'span' );

		labelEl.className = 'atme-side__label';
		labelEl.textContent = label;
		row.appendChild( labelEl );

		if ( typeof count === 'number' && count > 0 ) {
			const countEl = document.createElement( 'span' );

			countEl.className = 'atme-side__count';
			countEl.textContent = String( count );
			row.appendChild( countEl );
		}

		row.addEventListener( 'click', onClick );

		return row;
	}

	/* ------------------------------------------------------------------ *
	 * Data.
	 * ------------------------------------------------------------------ */

	private async runQuery(): Promise< void > {
		const epoch = ++this.queryEpoch;

		this.loading = true;
		this.page = 0;
		this.paintStatus( 'Loading…' );

		if ( 'duplicates' === this.query.view ) {
			await this.runDuplicatesQuery( epoch );

			return;
		}

		try {
			const result = await fetchMedia( this.query, 1 );

			// A stale answer for a query the user has already left.
			if ( epoch !== this.queryEpoch ) {
				return;
			}

			this.page = 1;
			this.totalPages = result.totalPages;
			this.total = result.total;
			this.grid?.setItems( result.items );
		} catch ( error ) {
			this.paintStatus( error instanceof Error ? error.message : 'The library could not be loaded.' );

			return;
		} finally {
			this.loading = false;
		}

		this.paintStatus();
	}

	/**
	 * The duplicates view: hash groups resolved to items, group order kept
	 * so twins sit side by side.
	 */
	private async runDuplicatesQuery( epoch: number ): Promise< void > {
		try {
			const { hashed, groups } = await fetchDuplicates();

			if ( epoch !== this.queryEpoch ) {
				return;
			}

			const ids = groups.flatMap( ( group ) => group.ids ).slice( 0, 100 );
			const items = await fetchMediaByIds( ids );

			if ( epoch !== this.queryEpoch ) {
				return;
			}

			this.page = 1;
			this.totalPages = 1;
			this.total = items.length;
			this.grid?.setItems( items );
			this.paintStatus(
				items.length > 0
					? `${ groups.length } duplicate group${ groups.length === 1 ? '' : 's' } · ${ hashed } files checked so far — run the wizard scan to check the rest`
					: `No duplicates among the ${ hashed } files checked so far — run the wizard scan to check the rest`
			);
		} catch ( error ) {
			this.paintStatus( error instanceof Error ? error.message : 'Duplicates could not be loaded.' );
		} finally {
			this.loading = false;
		}
	}

	private async loadMore(): Promise< void > {
		if ( this.loading || this.page >= this.totalPages ) {
			return;
		}

		const epoch = this.queryEpoch;

		this.loading = true;

		try {
			const result = await fetchMedia( this.query, this.page + 1 );

			if ( epoch !== this.queryEpoch ) {
				return;
			}

			this.page += 1;
			this.totalPages = result.totalPages;
			this.total = result.total;
			this.grid?.appendItems( result.items );
		} finally {
			this.loading = false;
		}

		this.paintStatus();
	}

	private async refreshFolders(): Promise< void > {
		try {
			this.folders = await fetchFolders();
		} catch {
			// Keep the last known tree when a background refresh fails.
		}

		this.paintSidebar();
	}

	/** Changes announced by other windows: refetch just those rows. */
	private async onExternalChange( ids: number[] ): Promise< void > {
		if ( ids.length === 0 ) {
			// A bulk signal with no ids — refetch the current page set.
			void this.runQuery();

			return;
		}

		const shown = new Set( this.grid?.getItems().map( ( item ) => item.id ) ?? [] );
		const relevant = ids.filter( ( id ) => shown.has( id ) );

		const patched: MediaItem[] = [];
		const gone: number[] = [];

		await Promise.all(
			relevant.map( async ( id ) => {
				try {
					patched.push( await fetchMediaItem( id ) );
				} catch {
					gone.push( id );
				}
			} )
		);

		if ( patched.length ) {
			this.grid?.patchItems( patched );

			if ( this.openItemId && patched.some( ( item ) => item.id === this.openItemId ) ) {
				const fresh = patched.find( ( item ) => item.id === this.openItemId );

				if ( fresh ) {
					this.inspector?.show( fresh );
				}
			}
		}

		if ( gone.length ) {
			this.grid?.removeItems( gone );
		}
	}

	/* ------------------------------------------------------------------ *
	 * Uploads.
	 * ------------------------------------------------------------------ */

	/**
	 * OS files dropped on the window upload into the current folder.
	 *
	 * Native HTML5 drop — the one place it belongs, because the drag starts
	 * in Finder where the shell's pointer pipeline cannot see it.
	 */
	private wireUploadDrop( frame: HTMLElement ): void {
		const over = ( event: DragEvent ) => {
			if ( event.dataTransfer?.types.includes( 'Files' ) ) {
				event.preventDefault();
				frame.classList.add( 'is-drop-ready' );
			}
		};

		const leave = () => frame.classList.remove( 'is-drop-ready' );

		const drop = ( event: DragEvent ) => {
			if ( ! event.dataTransfer?.files.length ) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			leave();
			void this.uploadFiles( Array.from( event.dataTransfer.files ) );
		};

		// Paste is upload too — a screenshot on the clipboard is the most
		// common file nobody wants to save-as first.
		const paste = ( event: ClipboardEvent ) => {
			const files = Array.from( event.clipboardData?.files ?? [] );

			if ( files.length > 0 ) {
				event.preventDefault();
				void this.uploadFiles( files );
			}
		};

		frame.addEventListener( 'dragover', over );
		frame.addEventListener( 'dragleave', leave );
		frame.addEventListener( 'drop', drop );
		frame.addEventListener( 'paste', paste );

		this.teardowns.push( () => {
			frame.removeEventListener( 'dragover', over );
			frame.removeEventListener( 'dragleave', leave );
			frame.removeEventListener( 'drop', drop );
			frame.removeEventListener( 'paste', paste );
		} );
	}

	private async uploadFiles( files: File[] ): Promise< void > {
		const shell = getShell();
		let done = 0;
		let failed = 0;

		this.paintStatus( `Uploading 0/${ files.length }…` );

		for ( const file of files ) {
			try {
				const item = await uploadMedia( file, this.query.folder );

				done += 1;
				this.grid?.appendItems( [ item ] );
			} catch ( error ) {
				failed += 1;
				shell?.notify?.( {
					title: 'Upload failed',
					body: `${ file.name }: ${ error instanceof Error ? error.message : 'unknown error' }`,
					type: 'error',
				} );
			}

			this.paintStatus( `Uploading ${ done + failed }/${ files.length }…` );
		}

		this.total += done;
		this.paintStatus();

		if ( done > 0 ) {
			void this.refreshFolders();
			void this.runQuery();
		}
	}

	/* ------------------------------------------------------------------ *
	 * Inspector, selection, reveal.
	 * ------------------------------------------------------------------ */

	private onSelection( ids: number[] ): void {
		this.paintStatus();
		this.paintBulkBar( ids );

		// The panel follows the selection whenever it is on screen.
		if ( this.root.querySelector( '[data-atme-inspector]' )?.hasAttribute( 'hidden' ) ) {
			return;
		}

		if ( ids.length >= 1 ) {
			const item = this.grid?.getItems().find( ( candidate ) => candidate.id === ids[ 0 ] );

			if ( item ) {
				this.openItem( item );
			}
		} else {
			this.openItemId = 0;
			this.inspector?.showEmpty();
		}
	}

	private openItem( item: MediaItem ): void {
		this.openItemId = item.id;
		this.inspector?.show( item );
		this.root.querySelector( '[data-atme-inspector]' )?.removeAttribute( 'hidden' );
	}

	private closeInspector(): void {
		this.openItemId = 0;
		this.root.querySelector( '[data-atme-inspector]' )?.setAttribute( 'hidden', '' );
	}

	private async revealItem( id: number ): Promise< void > {
		if ( ! this.grid ) {
			return;
		}

		if ( ! this.grid.getItems().some( ( item ) => item.id === id ) ) {
			// Not on any loaded page — reset to the plain library so it can be.
			this.query = { ...DEFAULT_QUERY };
			await this.runQuery();
		}

		this.grid.reveal( id );

		const item = this.grid.getItems().find( ( candidate ) => candidate.id === id );

		if ( item ) {
			this.openItem( item );
		}
	}

	/**
	 * Declares what this window is, for the relations engine.
	 *
	 * Always the library root — never the item under inspection. The Media
	 * Viewer declares each open photo as a *child* of this root, which is
	 * what makes the shell draw the curved tie from a viewer window back to
	 * the explorer it came from. If the explorer instead re-declared itself
	 * as the inspected item, the two windows would be one subject and the
	 * desktop would have no edge to draw.
	 */
	private announceIdentity( itemId: number ): void {
		void itemId;
		setIdentity( this.root, libraryIdentity() );
	}

	/**
	 * The bulk bar: appears over the status bar when several tiles are
	 * selected, carrying the verbs that make sense for a set.
	 */
	private paintBulkBar( ids: number[] ): void {
		if ( ids.length < 2 ) {
			this.bulkBar?.remove();
			this.bulkBar = null;

			return;
		}

		if ( ! this.bulkBar ) {
			this.bulkBar = document.createElement( 'div' );
			this.bulkBar.className = 'atme-bulkbar';
			this.statusEl?.before( this.bulkBar );
		}

		const bar = this.bulkBar;

		bar.textContent = '';

		const label = document.createElement( 'span' );

		label.className = 'atme-bulkbar__label';
		label.textContent = `${ ids.length } selected`;
		bar.appendChild( label );

		const encode = getConfig().conversion.encode;

		for ( const format of [ 'webp', 'avif' ] ) {
			if ( ! encode[ format ] ) {
				continue;
			}

			bar.appendChild(
				buttonControl( {
					label: `Convert to ${ format.toUpperCase() }`,
					className: 'atme-button atme-button--small',
					onClick: () => void this.bulkConvert( ids, format ),
				} )
			);
		}

		if ( this.folders.length > 0 ) {
			bar.appendChild(
				selectControl( {
					label: 'File into folder',
					value: '',
					options: [
						{ value: '', label: 'File into…' },
						...this.folders.map( ( folder ) => ( { value: String( folder.id ), label: folder.name } ) ),
					],
					hideLabel: true,
					onChange: ( value ) => {
						const folder = Number( value );

						if ( folder > 0 ) {
							void this.saveToFolder( ids, folder );
						}
					},
				} )
			);
		}

		bar.appendChild(
			buttonControl( {
				label: 'Delete…',
				variant: 'danger',
				className: 'atme-button atme-button--small atme-button--danger',
				onClick: () => void this.bulkDelete( ids ),
			} )
		);
	}

	/**
	 * Converts a selection, one file at a time, as copies.
	 *
	 * Sequential on purpose: a parallel burst of Imagick decodes is how a
	 * shared host runs out of memory mid-batch.
	 */
	private async bulkConvert( ids: number[], format: string ): Promise< void > {
		let done = 0;
		let failed = 0;

		for ( const id of ids ) {
			this.paintStatus( `Converting ${ done + failed + 1 }/${ ids.length } to ${ format.toUpperCase() }…` );

			try {
				await convertMedia( id, { format } );
				done += 1;
			} catch {
				failed += 1;
			}
		}

		getShell()?.showToast?.( {
			message: `Converted ${ done } of ${ ids.length }${ failed ? ` — ${ failed } failed` : '' }`,
		} );
		void this.runQuery();
	}

	private async bulkDelete( ids: number[] ): Promise< void > {
		const shell = getShell();
		const message = `Delete ${ ids.length } items permanently? There is no trash for media, and anything using them will be left empty.`;

		const confirmed = shell?.confirm
			? await shell.confirm( { title: 'Delete media', message, confirmLabel: 'Delete all', danger: true } )
			: false;

		if ( ! confirmed ) {
			return;
		}

		let done = 0;

		for ( const id of ids ) {
			this.paintStatus( `Deleting ${ done + 1 }/${ ids.length }…` );

			try {
				await deleteMedia( id, true );
				this.grid?.removeItems( [ id ] );
				done += 1;
			} catch {
				// Skipped; the sweep continues.
			}
		}

		this.total = Math.max( 0, this.total - done );
		this.paintBulkBar( [] );
		this.paintStatus();
		void this.refreshFolders();
	}

	/* ------------------------------------------------------------------ *
	 * Status bar.
	 * ------------------------------------------------------------------ */

	private paintStatus( message?: string ): void {
		if ( ! this.statusEl ) {
			return;
		}

		if ( message ) {
			this.statusEl.textContent = message;

			return;
		}

		const selected = this.grid?.selectedIds().length ?? 0;
		const parts = [ `${ this.total } item${ this.total === 1 ? '' : 's' }` ];

		if ( selected > 0 ) {
			parts.push( `${ selected } selected` );
		}

		this.statusEl.textContent = parts.join( ' · ' );
	}

	public destroy(): void {
		this.disposed = true;
		this.queryEpoch++;
		this.nameForm?.destroy();
		this.nameForm = null;
		for ( const teardown of this.teardowns.splice( 0 ) ) {
			teardown();
		}

		for ( const off of this.folderDropOffs.splice( 0 ) ) {
			off();
		}

		this.quickLook?.destroy();
		this.quickLook = null;
		this.wizard?.destroy();
		this.wizard = null;
		this.bulkBar?.remove();
		this.bulkBar = null;
		this.grid?.destroy();
		this.grid = null;
		this.inspector?.destroy();
		this.inspector = null;
	}
}

/** Re-exported for the delete flow's confirm dialog. */
export async function confirmAndDelete( item: MediaItem ): Promise< boolean > {
	const shell = getShell();
	const usage = await fetchUsage( item.id ).catch( () => [] );

	const message =
		usage.length > 0
			? `“${ item.title || item.id }” is used in ${ usage.length } place${ usage.length === 1 ? '' : 's' }: ${ usage
					.slice( 0, 3 )
					.map( ( row ) => row.title )
					.join( ', ' ) }${ usage.length > 3 ? '…' : '' }. Deleting it will leave those spots empty.`
			: `Delete “${ item.title || item.id }” permanently? There is no trash for media.`;

	const confirmed = shell?.confirm
		? await shell.confirm( { title: 'Delete media', message, confirmLabel: 'Delete', danger: true } )
		: false;

	if ( ! confirmed ) {
		return false;
	}

	await deleteMedia( item.id, true );

	return true;
}
