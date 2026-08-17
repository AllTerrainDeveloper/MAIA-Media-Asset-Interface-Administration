/**
 * The selection model, tested bare.
 *
 * Finder rules, without a Finder: plain click selects one, ⌘-click toggles,
 * shift-click ranges from the anchor, and a drag starting inside the
 * selection carries all of it. The model is pure state, so these tests are
 * the whole specification.
 */

import { describe, expect, it } from 'vitest';
import { SelectionModel } from '../../src/selection';

function model( ids: number[] = [ 1, 2, 3, 4, 5 ] ): SelectionModel {
	const selection = new SelectionModel();

	selection.setOrder( ids );

	return selection;
}

describe( 'SelectionModel', () => {
	it( 'selects one on a plain click', () => {
		const selection = model();

		selection.select( 3 );

		expect( selection.ids() ).toEqual( [ 3 ] );
	} );

	it( 'toggles on ⌘-click and keeps the rest', () => {
		const selection = model();

		selection.select( 2 );
		selection.toggle( 4 );

		expect( selection.ids() ).toEqual( [ 2, 4 ] );

		selection.toggle( 2 );

		expect( selection.ids() ).toEqual( [ 4 ] );
	} );

	it( 'ranges from the anchor on shift-click, replacing the selection', () => {
		const selection = model();

		selection.select( 2 );
		selection.range( 5 );

		expect( selection.ids() ).toEqual( [ 2, 3, 4, 5 ] );

		// Backwards works too.
		selection.range( 1 );

		expect( selection.ids() ).toEqual( [ 1, 2 ] );
	} );

	it( 'falls back to a plain select when there is no anchor', () => {
		const selection = model();

		selection.range( 3 );

		expect( selection.ids() ).toEqual( [ 3 ] );
	} );

	it( 'hands ids back in grid order, not click order', () => {
		const selection = model();

		selection.select( 5 );
		selection.toggle( 1 );
		selection.toggle( 3 );

		expect( selection.ids() ).toEqual( [ 1, 3, 5 ] );
	} );

	it( 'drops items that leave the query', () => {
		const selection = model();

		selection.select( 2 );
		selection.toggle( 4 );
		selection.setOrder( [ 1, 2, 3 ] );

		expect( selection.ids() ).toEqual( [ 2 ] );
	} );

	it( 'clears the anchor when its item leaves the query', () => {
		const selection = model();

		selection.select( 4 );
		selection.setOrder( [ 1, 2, 3 ] );
		selection.range( 2 );

		// No anchor left, so the range collapses to a plain select.
		expect( selection.ids() ).toEqual( [ 2 ] );
	} );

	it( 'selects everything in order', () => {
		const selection = model();

		selection.selectAll();

		expect( selection.ids() ).toEqual( [ 1, 2, 3, 4, 5 ] );
		expect( selection.count() ).toBe( 5 );
	} );

	it( 'carries the whole selection when the grab lands inside it', () => {
		const selection = model();

		selection.select( 1 );
		selection.toggle( 3 );

		expect( selection.dragSet( 3 ) ).toEqual( [ 1, 3 ] );
	} );

	it( 'carries only the grabbed tile when the grab lands outside', () => {
		const selection = model();

		selection.select( 1 );
		selection.toggle( 3 );

		expect( selection.dragSet( 5 ) ).toEqual( [ 5 ] );
	} );
} );
