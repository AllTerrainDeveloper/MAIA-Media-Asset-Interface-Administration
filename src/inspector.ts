/**
 * The inspector: one item's whole story, in the right-hand column.
 *
 * Preview, editable fields, file facts, where it is used, version history,
 * and the convert / replace verbs. Fields save on blur; verbs confirm when
 * they destroy. The inspector never owns library state — it reports every
 * change up through its delegate and the app decides what repaints.
 */

import {
	convertMedia,
	fetchFacts,
	fetchUsage,
	fetchVersions,
	getConfig,
	getShell,
	regenerate,
	replaceMedia,
	rollbackVersion,
	updateMedia,
} from './api';
import { rotateMedia } from './api';
import { confirmAndDelete } from './app';
import { browserEncodeSupport, downloadAs } from './convert-client';
import { readExif } from './exif';
import {
	buttonControl,
	checkboxControl,
	emptyStateEl,
	noticeEl,
	rangeControl,
	selectControl,
	textControl,
	textareaControl,
} from './os-ui';
import type { MediaItem, UsageRow, Version } from './types';

export interface InspectorDelegate {
	onChanged( item: MediaItem ): void;
	onDeleted( id: number ): void;
	onClose(): void;
}

export interface Inspector {
	show( item: MediaItem ): void;
	/** The panel's resting state, when nothing is selected. */
	showEmpty(): void;
	destroy(): void;
}

/** Human bytes. */
function formatBytes( bytes: number ): string {
	if ( bytes <= 0 ) {
		return '—';
	}

	const units = [ 'B', 'KB', 'MB', 'GB' ];
	let value = bytes;
	let unit = 0;

	while ( value >= 1024 && unit < units.length - 1 ) {
		value /= 1024;
		unit += 1;
	}

	return `${ value < 10 && unit > 0 ? value.toFixed( 1 ) : Math.round( value ) } ${ units[ unit ] }`;
}

export function mountInspector( host: HTMLElement, delegate: InspectorDelegate ): Inspector {
	let current: MediaItem | null = null;
	let epoch = 0;

	host.classList.add( 'atme-inspector' );

	const render = ( item: MediaItem ) => {
		const thisEpoch = ++epoch;

		current = item;
		host.textContent = '';

		/* Header --------------------------------------------------------- */
		const header = document.createElement( 'div' );

		header.className = 'atme-inspector__header';

		const close = document.createElement( 'button' );

		close.type = 'button';
		close.className = 'atme-inspector__close';
		close.setAttribute( 'aria-label', 'Close inspector' );
		close.textContent = '×';
		close.addEventListener( 'click', () => delegate.onClose() );
		header.appendChild( close );

		host.appendChild( header );

		/* Preview -------------------------------------------------------- */
		const preview = document.createElement( 'div' );

		preview.className = 'atme-inspector__preview';

		if ( item.kind === 'image' && ( item.thumbnail || item.url ) ) {
			const img = document.createElement( 'img' );

			img.src = item.thumbnail || item.url;
			img.alt = item.alt;
			preview.appendChild( img );
		} else if ( item.kind === 'video' ) {
			const video = document.createElement( 'video' );

			video.src = item.url;
			video.controls = true;
			preview.appendChild( video );
		} else if ( item.kind === 'audio' ) {
			const audio = document.createElement( 'audio' );

			audio.src = item.url;
			audio.controls = true;
			preview.appendChild( audio );
		} else {
			const icon = document.createElement( 'span' );

			icon.className = 'dashicons dashicons-media-default';
			preview.appendChild( icon );
		}

		host.appendChild( preview );

		/* Fields ---------------------------------------------------------- */
		const fields = document.createElement( 'div' );

		fields.className = 'atme-inspector__fields';

		const addField = (
			label: string,
			value: string,
			key: 'title' | 'alt_text' | 'caption' | 'description',
			multiline = false
		) => {
			// Autosave, debounced: the field saves itself a beat after typing
			// stops, so there is no Save button to forget and no blur to miss.
			let saveTimer = 0;
			let lastSaved = value;

			const onInput = ( next: string ) => {
				window.clearTimeout( saveTimer );
				saveTimer = window.setTimeout( () => {
					if ( ! current || next === lastSaved ) {
						return;
					}

					void updateMedia( current.id, { [ key ]: next } )
						.then( ( fresh ) => {
							lastSaved = next;

							if ( epoch === thisEpoch ) {
								current = fresh;
							}

							delegate.onChanged( fresh );
						} )
						.catch( ( error: Error ) => {
							getShell()?.notify?.( { title: 'Could not save', body: error.message, type: 'error' } );
						} );
				}, 800 );
			};

			const control = multiline
				? textareaControl( { label, value, className: 'atme-field__input', onInput } )
				: textControl( { label, value, className: 'atme-field__input', onInput } );

			control.classList.add( 'atme-field' );
			fields.appendChild( control );
		};

		addField( 'Title', item.title, 'title' );

		if ( item.kind === 'image' ) {
			addField( 'Alt text', item.alt, 'alt_text', true );

			// The shell's assistant drafts alt text on request. Gated on the
			// API existing; a human still reads it before it matters.
			if ( getShell()?.ai?.ask ) {
				const suggest = buttonControl( {
					label: 'Suggest alt text (AI)',
					className: 'atme-button atme-button--small',
					onClick: () => {
						suggest.setAttribute( 'disabled', '' );

						void getShell()!
							.ai!.ask!(
								`Write concise, descriptive alt text (under 15 words, no quotes, no "image of") for a WordPress media item. Its file URL is ${ item.url }, its title is "${ item.title }" and its caption is "${ item.caption }". Reply with the alt text only.`
							)
							.then( ( answer ) => {
								// The assistant resolves an AskResult envelope; the
								// reply text is its `message`. Anything else — a
								// tool call, an empty reply — is not alt text.
								const text =
									typeof answer === 'string'
										? answer
										: String( answer?.message ?? '' );
								const alt = text.trim().replace( /^"|"$/g, '' );

								if ( ! alt || alt.length > 300 ) {
									getShell()?.notify?.( {
										title: 'No suggestion',
										body: 'The assistant did not return usable alt text.',
										type: 'error',
									} );

									return;
								}

								return updateMedia( item.id, { alt_text: alt } ).then( ( fresh ) => {
									getShell()?.showToast?.( { message: 'Alt text drafted — give it a read' } );
									delegate.onChanged( fresh );
									render( fresh );
								} );
							} )
							.catch( ( error: Error ) =>
								getShell()?.notify?.( { title: 'No suggestion', body: error.message, type: 'error' } )
							)
							.finally( () => suggest.removeAttribute( 'disabled' ) );
					},
				} );

				fields.appendChild( suggest );
			}
		}

		addField( 'Caption', item.caption, 'caption', true );
		host.appendChild( fields );

		/* Facts ----------------------------------------------------------- */
		const facts = document.createElement( 'dl' );

		facts.className = 'atme-inspector__facts';

		const addFact = ( term: string, detail: string ) => {
			const dt = document.createElement( 'dt' );
			const dd = document.createElement( 'dd' );

			dt.textContent = term;
			dd.textContent = detail;
			facts.appendChild( dt );
			facts.appendChild( dd );
		};

		addFact( 'Type', item.mime || '—' );

		if ( item.width > 0 ) {
			addFact( 'Dimensions', `${ item.width } × ${ item.height }` );
		}

		addFact( 'Uploaded', item.date ? new Date( item.date + 'Z' ).toLocaleDateString() : '—' );

		if ( item.bytes > 0 ) {
			addFact( 'Size', formatBytes( item.bytes ) );
		}

		host.appendChild( facts );

		// The camera's own story, read in the browser — no server trip.
		if ( item.kind === 'image' && 'image/svg+xml' !== item.mime ) {
			void readExif( item.url )
				.then( ( exif ) => {
					if ( epoch !== thisEpoch || ! exif ) {
						return;
					}

					if ( exif.camera ) {
						addFact( 'Camera', exif.camera );
					}

					if ( exif.exposure ) {
						addFact( 'Exposure', exif.exposure );
					}

					if ( exif.taken ) {
						addFact( 'Taken', exif.taken );
					}
				} )
				.catch( () => undefined );
		}

		// Bytes are often missing from the REST row; the facts endpoint
		// always knows, and quietly fills the gap in.
		if ( item.bytes <= 0 ) {
			void fetchFacts( item.id )
				.then( ( { facts: fileFacts } ) => {
					if ( epoch === thisEpoch && fileFacts.bytes > 0 ) {
						addFact( 'Size', formatBytes( fileFacts.bytes ) );
					}
				} )
				.catch( () => undefined );
		}

		/* Actions --------------------------------------------------------- */
		const actions = document.createElement( 'div' );

		actions.className = 'atme-inspector__actions';

		const button = ( label: string, onClick: () => void, variant?: 'primary' | 'danger' ) => {
			const el = buttonControl( {
				label,
				onClick,
				variant,
				className: `atme-button${ variant ? ` atme-button--${ variant }` : '' }`,
			} );

			actions.appendChild( el );

			return el;
		};

		button( 'Copy URL', () => {
			void navigator.clipboard?.writeText( item.url ).then( () => {
				getShell()?.showToast?.( { message: 'URL copied' } );
			} );
		} );

		button( 'Download', () => {
			const link = document.createElement( 'a' );

			link.href = item.url;
			link.download = '';
			link.rel = 'noopener';
			link.click();
		} );

		if ( item.kind === 'image' ) {
			button( '↺ Rotate left', () => {
				void rotateMedia( item.id, item.mime, 270 )
					.then( () => {
						getShell()?.showToast?.( { message: 'Rotated — the old orientation is a version' } );
						delegate.onChanged( item );
					} )
					.catch( ( error: Error ) =>
						getShell()?.notify?.( { title: 'Could not rotate', body: error.message, type: 'error' } )
					);
			} );

			button( '↻ Rotate right', () => {
				void rotateMedia( item.id, item.mime, 90 )
					.then( () => {
						getShell()?.showToast?.( { message: 'Rotated — the old orientation is a version' } );
						delegate.onChanged( item );
					} )
					.catch( ( error: Error ) =>
						getShell()?.notify?.( { title: 'Could not rotate', body: error.message, type: 'error' } )
					);
			} );
		}

		button( 'Regenerate sizes', () => {
			void regenerate( item.id )
				.then( () => getShell()?.showToast?.( { message: 'Sizes rebuilt' } ) )
				.catch( ( error: Error ) =>
					getShell()?.notify?.( { title: 'Could not regenerate', body: error.message, type: 'error' } )
				);
		} );

		button(
			'Delete…',
			() => {
				void confirmAndDelete( item ).then( ( deleted ) => {
					if ( deleted ) {
						delegate.onDeleted( item.id );
					}
				} );
			},
			'danger'
		);

		host.appendChild( actions );

		/* Convert --------------------------------------------------------- */
		if ( item.kind === 'image' ) {
			host.appendChild( buildConvertSection( item, delegate ) );
			host.appendChild( buildDownloadAsSection( item ) );
			host.appendChild( buildReplaceSection( item, delegate ) );
		}

		/* Used in ---------------------------------------------------------- */
		const usageSection = document.createElement( 'div' );

		usageSection.className = 'atme-inspector__section';

		const usageTitle = document.createElement( 'h3' );

		usageTitle.textContent = 'Used in';
		usageSection.appendChild( usageTitle );

		const usageBody = document.createElement( 'div' );

		usageBody.className = 'atme-inspector__usage';
		usageBody.textContent = 'Looking…';
		usageSection.appendChild( usageBody );
		host.appendChild( usageSection );

		void fetchUsage( item.id )
			.then( ( rows ) => {
				if ( epoch !== thisEpoch ) {
					return;
				}

				paintUsage( usageBody, rows );
			} )
			.catch( () => {
				usageBody.textContent = 'Could not be determined.';
			} );

		/* Versions --------------------------------------------------------- */
		const versionsSection = document.createElement( 'div' );

		versionsSection.className = 'atme-inspector__section';

		const versionsTitle = document.createElement( 'h3' );

		versionsTitle.textContent = 'Versions';
		versionsSection.appendChild( versionsTitle );

		const versionsBody = document.createElement( 'div' );

		versionsBody.className = 'atme-inspector__versions';
		versionsSection.appendChild( versionsBody );
		host.appendChild( versionsSection );

		void fetchVersions( item.id )
			.then( ( versions ) => {
				if ( epoch !== thisEpoch ) {
					return;
				}

				paintVersions( versionsBody, item, versions, delegate );
			} )
			.catch( () => {
				versionsBody.textContent = '';
			} );
	};

	const paintUsage = ( body: HTMLElement, rows: UsageRow[] ) => {
		body.textContent = '';

		if ( rows.length === 0 ) {
			body.appendChild(
				emptyStateEl( { title: 'Not used anywhere', body: 'Safe to delete.', icon: 'dashicons-yes-alt' } )
			);

			return;
		}

		for ( const row of rows ) {
			const link = document.createElement( 'a' );

			link.className = 'atme-usage__row';
			link.href = row.editUrl || '#';
			link.textContent = `${ row.title || `#${ row.postId }` } — ${ row.typeLabel }${
				row.usedAs === 'featured' ? ' (featured image)' : ''
			}`;

			link.addEventListener( 'click', ( event ) => {
				event.preventDefault();

				const shell = getShell();

				if ( shell?.windowManager?.open && row.editUrl ) {
					const id = shell.deriveWindowId?.( row.editUrl ) ?? `atme-usage-${ row.postId }`;

					shell.windowManager.open( { id, baseId: id, url: row.editUrl, title: row.title, icon: 'dashicons-edit' } );
				} else if ( row.editUrl ) {
					window.open( row.editUrl, '_blank', 'noopener' );
				}
			} );

			body.appendChild( link );
		}
	};

	const paintVersions = (
		body: HTMLElement,
		item: MediaItem,
		versions: Version[],
		versionDelegate: InspectorDelegate
	) => {
		body.textContent = '';

		if ( versions.length === 0 ) {
			body.appendChild( noticeEl( 'No earlier versions. Replacing or converting in place stashes one.' ) );

			return;
		}

		for ( const version of versions ) {
			const row = document.createElement( 'div' );

			row.className = 'atme-version__row';

			const label = document.createElement( 'span' );

			label.textContent = `${ new Date( version.date ).toLocaleString() } · ${ version.mime } · ${ formatBytes(
				version.bytes
			) }`;
			row.appendChild( label );

			const restore = buttonControl( {
				label: 'Restore',
				className: 'atme-button atme-button--small',
				onClick: () => {
				void rollbackVersion( item.id, version.file )
					.then( () => {
						getShell()?.showToast?.( { message: 'Version restored' } );
						versionDelegate.onChanged( item );
					} )
					.catch( ( error: Error ) =>
						getShell()?.notify?.( { title: 'Could not restore', body: error.message, type: 'error' } )
					);
				},
			} );

			row.appendChild( restore );

			body.appendChild( row );
		}
	};

	const renderEmpty = () => {
		epoch += 1;
		current = null;
		host.textContent = '';
		host.appendChild(
			emptyStateEl( {
				title: 'Nothing selected',
				body: 'Click a tile to see everything about it here.',
				icon: 'dashicons-info-outline',
			} )
		);
	};

	return {
		show: render,
		showEmpty: renderEmpty,
		destroy: () => {
			host.textContent = '';
			current = null;
		},
	};
}

/** The convert controls: format, quality, copy-or-replace. */
function buildConvertSection( item: MediaItem, delegate: InspectorDelegate ): HTMLElement {
	const section = document.createElement( 'div' );

	section.className = 'atme-inspector__section';

	const title = document.createElement( 'h3' );

	title.textContent = 'Convert';
	section.appendChild( title );

	const encode = getConfig().conversion.encode;
	const currentFormat = item.mime.replace( 'image/', '' ).replace( 'jpg', 'jpeg' );

	const state = { format: '', quality: 82, replace: false, stripMeta: false };

	const options = [ 'webp', 'avif', 'jpeg', 'png' ]
		.filter( ( slug ) => slug !== currentFormat )
		.map( ( slug ) => ( {
			value: slug,
			label: slug.toUpperCase() + ( encode[ slug ] ? '' : ' (unavailable here)' ),
		} ) );

	state.format = options.find( ( option ) => encode[ option.value ] )?.value ?? options[ 0 ]?.value ?? 'webp';

	const row = document.createElement( 'div' );

	row.className = 'atme-convert';

	row.appendChild(
		selectControl( {
			label: 'Target format',
			value: state.format,
			options,
			hideLabel: true,
			onChange: ( value ) => {
				state.format = value;
			},
		} )
	);

	section.appendChild( row );

	section.appendChild(
		rangeControl( {
			label: 'Quality',
			value: state.quality,
			min: 40,
			max: 100,
			onChange: ( value ) => {
				state.quality = value;
			},
		} )
	);

	section.appendChild(
		checkboxControl( {
			label: 'Strip EXIF and location data (the colour profile stays)',
			onChange: ( checked ) => {
				state.stripMeta = checked;
			},
		} )
	);

	section.appendChild(
		checkboxControl( {
			label: 'Replace in place (same URL; the old file is kept as a version)',
			onChange: ( checked ) => {
				state.replace = checked;
			},
		} )
	);

	const go = buttonControl( {
		label: 'Convert',
		variant: 'primary',
		className: 'atme-button atme-button--primary',
		onClick: () => {
			run();
		},
	} ) as HTMLElement & { disabled?: boolean };

	const run = () => {
		go.setAttribute( 'disabled', '' );

		void convertMedia( item.id, {
			format: state.format,
			quality: state.quality,
			strip_meta: state.stripMeta,
			replace: state.replace,
		} )
			.then( ( result ) => {
				const saved = item.bytes > 0 && result.facts.bytes > 0 ? item.bytes - result.facts.bytes : 0;

				getShell()?.showToast?.( {
					message: result.replaced
						? `Converted in place${ saved > 0 ? ` — ${ formatBytes( saved ) } saved` : '' }`
						: 'Converted copy created',
				} );
				delegate.onChanged( item );
			} )
			.catch( ( error: Error ) => {
				getShell()?.notify?.( { title: 'Conversion failed', body: error.message, type: 'error' } );
			} )
			.finally( () => {
				go.removeAttribute( 'disabled' );
			} );
	};

	section.appendChild( go );

	return section;
}

/** The replace-file well. */
function buildReplaceSection( item: MediaItem, delegate: InspectorDelegate ): HTMLElement {
	const section = document.createElement( 'div' );

	section.className = 'atme-inspector__section';

	const title = document.createElement( 'h3' );

	title.textContent = 'Replace file';
	section.appendChild( title );

	section.appendChild(
		noticeEl( 'Swap the file, keep the URL. Every post using it shows the new one; the old file becomes a version.' )
	);

	const picker = document.createElement( 'input' );

	picker.type = 'file';
	picker.hidden = true;

	const choose = buttonControl( {
		label: 'Choose replacement…',
		className: 'atme-button',
		onClick: () => picker.click(),
	} );

	picker.addEventListener( 'change', () => {
		const file = picker.files?.[ 0 ];

		if ( ! file ) {
			return;
		}

		choose.setAttribute( 'disabled', '' );

		void replaceMedia( item.id, file )
			.then( () => {
				getShell()?.showToast?.( { message: 'File replaced' } );
				delegate.onChanged( item );
			} )
			.catch( ( error: Error ) => {
				getShell()?.notify?.( { title: 'Replace failed', body: error.message, type: 'error' } );
			} )
			.finally( () => {
				choose.removeAttribute( 'disabled' );
				picker.value = '';
			} );
	} );

	section.appendChild( choose );
	section.appendChild( picker );

	return section;
}

/**
 * "Download as…" — a copy in another format, made in the browser.
 *
 * Never touches the library and never needs the server to know the format:
 * WebP/JPEG/PNG encode on the canvas, AVIF through the lazy WASM codec. The
 * fallback story for a host whose PHP cannot encode a format at all.
 */
function buildDownloadAsSection( item: MediaItem ): HTMLElement {
	const section = document.createElement( 'div' );

	section.className = 'atme-inspector__section';

	const title = document.createElement( 'h3' );

	title.textContent = 'Download as';
	section.appendChild( title );

	const support = browserEncodeSupport();
	const currentFormat = item.mime.replace( 'image/', '' ).replace( 'jpg', 'jpeg' );
	const row = document.createElement( 'div' );

	row.className = 'atme-inspector__actions';

	for ( const format of [ 'webp', 'avif', 'jpeg', 'png' ] ) {
		if ( format === currentFormat || ! support[ format ] ) {
			continue;
		}

		const el = buttonControl( {
			label: format.toUpperCase(),
			className: 'atme-button atme-button--small',
			onClick: () => {
				el.setAttribute( 'disabled', '' );

				void downloadAs( item, format )
					.then( () => getShell()?.showToast?.( { message: `Downloading as ${ format.toUpperCase() }` } ) )
					.catch( ( error: Error ) =>
						getShell()?.notify?.( { title: 'Could not convert', body: error.message, type: 'error' } )
					)
					.finally( () => el.removeAttribute( 'disabled' ) );
			},
		} );

		row.appendChild( el );
	}

	section.appendChild( row );

	return section;
}
