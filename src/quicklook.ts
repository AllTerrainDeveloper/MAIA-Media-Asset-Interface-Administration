/**
 * Quick Look: spacebar opens a full preview, arrows walk the library.
 *
 * The macOS gesture, because it is the fastest triage loop a library can
 * offer: eyes on the photo, one hand on the keyboard, no clicks. The overlay
 * mounts on the window body (not `document.body`) so it stays inside the
 * window's stacking context and closes with it.
 */

import type { MediaItem } from './types';

export interface QuickLook {
	/** Opens on an item, or moves to it if already open. */
	open( item: MediaItem ): void;
	close(): void;
	isOpen(): boolean;
	destroy(): void;
}

export function mountQuickLook(
	host: HTMLElement,
	navigate: ( direction: 1 | -1 ) => MediaItem | null
): QuickLook {
	let overlay: HTMLElement | null = null;

	const close = () => {
		overlay?.remove();
		overlay = null;
	};

	const paint = ( item: MediaItem ) => {
		if ( ! overlay ) {
			return;
		}

		const stage = overlay.querySelector< HTMLElement >( '.atme-quicklook__stage' );
		const caption = overlay.querySelector< HTMLElement >( '.atme-quicklook__caption' );

		if ( ! stage || ! caption ) {
			return;
		}

		stage.textContent = '';

		if ( item.kind === 'image' ) {
			const img = document.createElement( 'img' );

			img.src = item.url;
			img.alt = item.alt;
			stage.appendChild( img );
		} else if ( item.kind === 'video' ) {
			const video = document.createElement( 'video' );

			video.src = item.url;
			video.controls = true;
			video.autoplay = true;
			stage.appendChild( video );
		} else if ( item.kind === 'audio' ) {
			const audio = document.createElement( 'audio' );

			audio.src = item.url;
			audio.controls = true;
			audio.autoplay = true;
			stage.appendChild( audio );
		} else {
			const icon = document.createElement( 'span' );

			icon.className = 'dashicons dashicons-media-default';
			stage.appendChild( icon );
		}

		const dimensions = item.width > 0 ? ` — ${ item.width } × ${ item.height }` : '';

		caption.textContent = `${ item.title || `#${ item.id }` }${ dimensions }`;
	};

	const onKeydown = ( event: KeyboardEvent ) => {
		if ( ! overlay ) {
			return;
		}

		if ( event.key === 'Escape' || event.key === ' ' ) {
			event.preventDefault();
			event.stopPropagation();
			close();

			return;
		}

		if ( event.key === 'ArrowRight' || event.key === 'ArrowLeft' ) {
			event.preventDefault();
			event.stopPropagation();

			const next = navigate( event.key === 'ArrowRight' ? 1 : -1 );

			if ( next ) {
				paint( next );
			}
		}
	};

	// Window-level capture: ahead of both the grid's handler and the
	// shell's document-capture Space-switch arrows.
	window.addEventListener( 'keydown', onKeydown, true );

	return {
		open( item: MediaItem ) {
			if ( ! overlay ) {
				overlay = document.createElement( 'div' );
				overlay.className = 'atme-quicklook';
				overlay.setAttribute( 'role', 'dialog' );
				overlay.setAttribute( 'aria-label', 'Preview' );

				const stage = document.createElement( 'div' );

				stage.className = 'atme-quicklook__stage';
				overlay.appendChild( stage );

				const caption = document.createElement( 'div' );

				caption.className = 'atme-quicklook__caption';
				overlay.appendChild( caption );

				overlay.addEventListener( 'click', ( event ) => {
					if ( event.target === overlay ) {
						close();
					}
				} );

				host.appendChild( overlay );
			}

			paint( item );
		},
		close,
		isOpen: () => !! overlay,
		destroy() {
			window.removeEventListener( 'keydown', onKeydown, true );
			close();
		},
	};
}
