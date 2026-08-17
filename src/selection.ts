/**
 * The selection model, kept apart from the DOM so it can be tested bare.
 *
 * Finder rules: click selects one, ⌘/Ctrl-click toggles one, Shift-click
 * selects the range from the anchor, and the anchor is wherever the last
 * plain click landed. Order matters — "the selection" hands ids back in grid
 * order, because a drag of three tiles should ghost them the way they look.
 */

export class SelectionModel {
	private selected = new Set< number >();
	private anchorId = 0;
	private order: number[] = [];

	/** Tells the model what the grid currently shows, in order. */
	public setOrder( ids: number[] ): void {
		this.order = [ ...ids ];

		// Items that scrolled out of the query are no longer selectable.
		const visible = new Set( ids );

		this.selected = new Set( [ ...this.selected ].filter( ( id ) => visible.has( id ) ) );

		if ( this.anchorId && ! visible.has( this.anchorId ) ) {
			this.anchorId = 0;
		}
	}

	/** A plain click: this item, alone. */
	public select( id: number ): void {
		this.selected = new Set( [ id ] );
		this.anchorId = id;
	}

	/** ⌘/Ctrl-click: toggles one, moves the anchor to it. */
	public toggle( id: number ): void {
		if ( this.selected.has( id ) ) {
			this.selected.delete( id );
		} else {
			this.selected.add( id );
		}

		this.anchorId = id;
	}

	/** Shift-click: the run from the anchor to here, replacing the selection. */
	public range( id: number ): void {
		if ( ! this.anchorId ) {
			this.select( id );

			return;
		}

		const from = this.order.indexOf( this.anchorId );
		const to = this.order.indexOf( id );

		if ( from === -1 || to === -1 ) {
			this.select( id );

			return;
		}

		const [ start, end ] = from < to ? [ from, to ] : [ to, from ];

		this.selected = new Set( this.order.slice( start, end + 1 ) );
	}

	/** Everything, in grid order. */
	public selectAll(): void {
		this.selected = new Set( this.order );
	}

	public clear(): void {
		this.selected = new Set();
		this.anchorId = 0;
	}

	public has( id: number ): boolean {
		return this.selected.has( id );
	}

	public count(): number {
		return this.selected.size;
	}

	/** Selected ids, in the order the grid shows them. */
	public ids(): number[] {
		return this.order.filter( ( id ) => this.selected.has( id ) );
	}

	/**
	 * The set a drag starting on `id` carries: the selection when the grab
	 * landed inside it, just the grabbed tile when it landed outside.
	 */
	public dragSet( id: number ): number[] {
		return this.selected.has( id ) ? this.ids() : [ id ];
	}
}
