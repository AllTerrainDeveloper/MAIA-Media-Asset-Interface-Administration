import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../../src/types';
const mocks = vi.hoisted( () => ( { update: vi.fn(), suggest: vi.fn() } ) );
vi.mock( '../../src/api', () => ( {
	updateMedia: mocks.update,
	fetchFacts: vi.fn().mockResolvedValue( { facts: { bytes: 0 } } ),
	fetchUsage: vi.fn().mockResolvedValue( [] ),
	fetchVersions: vi.fn().mockResolvedValue( [] ),
	getConfig: () => ( { conversion: { encode: { webp: true } } } ),
	getShell: () => ( { ai: { ask: () => undefined } } ),
} ) );
vi.mock( '../../src/ai', () => ( { suggestAltText: mocks.suggest } ) );
vi.mock( '../../src/app', () => ( { confirmAndDelete: vi.fn() } ) );
vi.mock( '../../src/exif', () => ( { readExif: vi.fn().mockResolvedValue( null ) } ) );
vi.mock( '../../src/convert-client', () => ( { browserEncodeSupport: () => ( {} ), downloadAs: vi.fn() } ) );
import { mountInspector } from '../../src/inspector';

const item = ( id: number ) => ( { id, title: `Photo ${id}`, kind: 'image', mime: 'image/jpeg', url: 'https://example.test/photo.jpg', date: '2026-09-12', alt: '', caption: '', width: 10, height: 10 } as MediaItem );
afterEach( () => { vi.useRealTimers(); vi.clearAllMocks(); document.body.replaceChildren(); } );

function setup() {
	const host = document.createElement( 'div' );
	document.body.appendChild( host );
	const inspector = mountInspector( host, { onChanged: vi.fn(), onDeleted: vi.fn(), onClose: vi.fn() } );
	return { host, inspector };
}

describe( 'inspector asynchronous edits', () => {
	it( 'saves delayed typing to the edited image after the selection changes', async () => {
		vi.useFakeTimers();
		mocks.update.mockResolvedValue( item( 1 ) );
		const { host, inspector } = setup();
		inspector.show( item( 1 ) );
		const title = host.querySelector( 'input' )!;
		title.value = 'First image title';
		title.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		inspector.show( item( 2 ) );
		await vi.advanceTimersByTimeAsync( 900 );
		expect( mocks.update ).toHaveBeenCalledWith( 1, { title: 'First image title' } );
		expect( host.querySelector( 'input' )!.value ).toBe( 'Photo 2' );
		inspector.destroy();
	} );
	it( 'does not save an AI reply after the inspector closes', async () => {
		let answer!: ( text: string ) => void;
		mocks.suggest.mockReturnValue( new Promise( resolve => { answer = resolve; } ) );
		const { host, inspector } = setup();
		inspector.show( item( 1 ) );
		Array.from( host.querySelectorAll( 'button' ) ).find( button => button.textContent === 'Suggest alt text (AI)' )!.click();
		inspector.destroy();
		answer( 'A bird in flight' );
		await Promise.resolve(); await Promise.resolve();
		expect( mocks.update ).not.toHaveBeenCalled();
		expect( host.childElementCount ).toBe( 0 );
	} );
} );
