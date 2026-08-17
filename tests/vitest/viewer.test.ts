/**
 * The viewer's zoom arithmetic, tested bare.
 *
 * Fit must never enlarge past 1:1, and the +/− stops must move exactly one
 * notch from any floating fit value — the behaviours that make zoom feel
 * predictable rather than jumpy.
 */

import { describe, expect, it } from 'vitest';
import { fitScale, nextZoomStop } from '../../src/viewer';

describe( 'fitScale', () => {
	it( 'shrinks to the tighter axis', () => {
		expect( fitScale( 2000, 1000, 1000, 1000 ) ).toBe( 0.5 );
		expect( fitScale( 1000, 2000, 1000, 1000 ) ).toBe( 0.5 );
	} );

	it( 'never enlarges a small image past 1:1', () => {
		expect( fitScale( 100, 100, 1000, 1000 ) ).toBe( 1 );
	} );

	it( 'answers 1 for degenerate boxes instead of dividing by zero', () => {
		expect( fitScale( 0, 100, 500, 500 ) ).toBe( 1 );
		expect( fitScale( 100, 100, 0, 500 ) ).toBe( 1 );
	} );
} );

describe( 'nextZoomStop', () => {
	it( 'steps up to the next stop from a floating fit scale', () => {
		expect( nextZoomStop( 0.89, 1 ) ).toBe( 1 );
		expect( nextZoomStop( 1, 1 ) ).toBe( 1.5 );
	} );

	it( 'steps down symmetrically', () => {
		expect( nextZoomStop( 0.89, -1 ) ).toBe( 0.75 );
		expect( nextZoomStop( 0.25, -1 ) ).toBe( 0.1 );
	} );

	it( 'clamps at both ends', () => {
		expect( nextZoomStop( 8, 1 ) ).toBe( 8 );
		expect( nextZoomStop( 0.1, -1 ) ).toBe( 0.1 );
	} );
} );
