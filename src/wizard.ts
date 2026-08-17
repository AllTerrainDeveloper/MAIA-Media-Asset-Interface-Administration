/**
 * The Optimization Wizard: scan → findings → remedies → batch → report.
 *
 * The whole loop is client-driven. The server answers one scan chunk at a
 * time and applies one remedy at a time through the ordinary convert and
 * alt-text endpoints; the wizard is just those verbs run over a queue with a
 * progress bar. Sequential on purpose — a parallel burst of Imagick decodes
 * is how a shared host dies mid-batch — and resumable, because the queue is
 * persisted server-side every few items and offered back after a closed
 * window.
 *
 * It never deletes on its own: duplicate cleanup lists the groups and asks.
 */

import { convertMedia, fetchWizardState, getConfig, getShell, saveWizardState, scanChunk, updateMedia } from './api';

/**
 * The dock tile wears the findings count until they are dealt with.
 *
 * One id across all three rails, per the shell's badge convention; 0 clears.
 */
function setFindingsBadge( count: number ): void {
	const shell = getShell();

	shell?.dock?.setBadge?.( 'allterrain-media-explorer', count );
	shell?.sideDock?.setBadge?.( 'allterrain-media-explorer', count );
	shell?.icons?.setBadge?.( 'allterrain-media-explorer', count );
}
import { buttonControl, checkboxControl, emptyStateEl, noticeEl, rangeControl, registered } from './os-ui';
import type { Finding } from './types';

/** `image/jpeg` → `jpeg`, with the engine's `jpg` spelling normalized. */
function formatFromMime( mime?: string ): string {
	const slug = ( mime ?? '' ).replace( 'image/', '' );

	return 'jpg' === slug ? 'jpeg' : slug || 'jpeg';
}

export interface Wizard {
	open(): void;
	close(): void;
	destroy(): void;
}

/** What survives a closed window: the queue and where it stopped. */
interface WizardState {
	queue: Array< { id: number; remedy: string; format?: string; quality?: number; maxWidth?: number } >;
	done: number;
	failed: Array< { id: number; message: string } >;
}

/** The remedies the findings step offers. */
interface RemedyChoices {
	convertLegacy: boolean;
	format: string;
	quality: number;
	downscale: boolean;
	maxWidth: number;
}

export function mountWizard(
	host: HTMLElement,
	onLibraryChanged: () => void,
	onClosed?: () => void
): Wizard {
	let panel: HTMLElement | null = null;
	let cancelled = false;

	const close = () => {
		const wasOpen = !! panel;

		cancelled = true;
		panel?.remove();
		panel = null;
		inner = null;

		// Only announce a real close — destroy() and repeated calls must not
		// echo. The app repaints the sidebar's active state off this.
		if ( wasOpen ) {
			onClosed?.();
		}
	};

	let inner: HTMLElement | null = null;

	const shellPanel = (): HTMLElement => {
		if ( panel && inner ) {
			inner.textContent = '';

			return inner;
		}

		// The overlay is absolutely positioned against the host. Assert the
		// positioning context in JS as well as CSS: a session running a
		// stale stylesheet (long-lived desktop tabs survive deploys) would
		// otherwise anchor this to the window body and cover the sidebar.
		if ( 'static' === getComputedStyle( host ).position ) {
			host.style.position = 'relative';
		}

		panel = document.createElement( 'div' );
		panel.className = 'atme-wizard';
		panel.setAttribute( 'role', 'dialog' );
		panel.setAttribute( 'aria-label', 'Optimization wizard' );

		// One centered column: a wizard is a document, not a dashboard, and
		// content pinned to the left of a wide window reads as broken.
		inner = document.createElement( 'div' );
		inner.className = 'atme-wizard__inner';
		panel.appendChild( inner );

		host.appendChild( panel );

		return inner;
	};

	/**
	 * The progress strip: four labelled dots on one line, done ✓, current
	 * lit with the holographic fill, upcoming muted. Hand-rolled on the
	 * shell's tokens — the kit's `<os-steps>` is a vertical onboarding
	 * list, not a progress indicator, and borrowing it here is what made
	 * the first version of this screen look broken.
	 */
	const header = ( el: HTMLElement, title: string, step: number ) => {
		const top = document.createElement( 'div' );

		top.className = 'atme-wizard__header';

		const strip = document.createElement( 'ol' );

		strip.className = 'atme-wizard__strip';
		strip.setAttribute( 'aria-label', `Step ${ step + 1 } of 4` );

		[ 'Scan', 'Findings', 'Fix', 'Report' ].forEach( ( label, index ) => {
			const item = document.createElement( 'li' );

			item.className = 'atme-wizard__step';

			if ( index < step ) {
				item.classList.add( 'is-done' );
			}

			if ( index === step ) {
				item.classList.add( 'is-current' );
				item.setAttribute( 'aria-current', 'step' );
			}

			const dot = document.createElement( 'span' );

			dot.className = 'atme-wizard__stepdot';
			dot.textContent = index < step ? '✓' : String( index + 1 );
			item.appendChild( dot );

			const text = document.createElement( 'span' );

			text.className = 'atme-wizard__steplabel';
			text.textContent = label;
			item.appendChild( text );

			strip.appendChild( item );
		} );

		top.appendChild( strip );

		const closeButton = buttonControl( {
			label: 'Close',
			className: 'atme-button atme-button--small',
			onClick: close,
		} );

		closeButton.classList.add( 'atme-wizard__close' );
		top.appendChild( closeButton );
		el.appendChild( top );

		const heading = document.createElement( 'h2' );

		heading.className = 'atme-wizard__title';
		heading.textContent = title;
		el.appendChild( heading );
	};

	const progressBar = ( el: HTMLElement ): ( ( value: number, max: number, label: string ) => void ) => {
		let bar: HTMLElement;
		let text: HTMLElement;

		if ( registered( 'os-progress-bar' ) ) {
			bar = document.createElement( 'os-progress-bar' );
			bar.setAttribute( 'max', '100' );
			bar.setAttribute( 'value', '0' );
		} else {
			bar = document.createElement( 'progress' );
			( bar as HTMLProgressElement ).max = 100;
		}

		bar.classList.add( 'atme-wizard__progress' );
		el.appendChild( bar );

		text = document.createElement( 'div' );
		text.className = 'atme-wizard__progresstext';
		el.appendChild( text );

		return ( value, max, label ) => {
			const pct = max > 0 ? Math.round( ( value / max ) * 100 ) : 0;

			bar.setAttribute( 'value', String( pct ) );

			if ( bar instanceof HTMLProgressElement ) {
				bar.value = pct;
			}

			text.textContent = label;
		};
	};

	/* ------------------------------------------------------------------ *
	 * Step 1 — intro, and the offer to resume.
	 * ------------------------------------------------------------------ */

	const showIntro = async () => {
		const el = shellPanel();

		header( el, 'Optimize the library', 0 );

		const body = document.createElement( 'div' );

		body.className = 'atme-wizard__body';
		body.appendChild(
			noticeEl(
				'The wizard reads every image and reports what could be better: oversized originals, formats WebP would halve, missing alt text, duplicate files. Nothing changes until you say so.'
			)
		);
		el.appendChild( body );

		const saved = await fetchWizardState< WizardState >().catch( () => ( { state: null } ) );

		if ( saved.state && saved.state.queue.length > saved.state.done ) {
			const resume = document.createElement( 'div' );

			resume.className = 'atme-wizard__resume';
			resume.appendChild(
				noticeEl(
					`A previous run stopped at ${ saved.state.done } of ${ saved.state.queue.length } fixes.`,
					'warning'
				)
			);
			resume.appendChild(
				buttonControl( {
					label: 'Resume it',
					variant: 'primary',
					className: 'atme-button atme-button--primary',
					onClick: () => void runQueue( saved.state as WizardState ),
				} )
			);
			resume.appendChild(
				buttonControl( {
					label: 'Discard it',
					className: 'atme-button',
					onClick: () => {
						void saveWizardState( null );
						void showIntro();
					},
				} )
			);
			body.appendChild( resume );
		}

		const actions = document.createElement( 'div' );

		actions.className = 'atme-wizard__actions';
		actions.appendChild(
			buttonControl( {
				label: 'Scan the library',
				variant: 'primary',
				className: 'atme-button atme-button--primary',
				onClick: () => void runScan(),
			} )
		);
		el.appendChild( actions );
	};

	/* ------------------------------------------------------------------ *
	 * Step 2 — the scan.
	 * ------------------------------------------------------------------ */

	const runScan = async () => {
		const el = shellPanel();

		header( el, 'Scanning…', 0 );

		const body = document.createElement( 'div' );

		body.className = 'atme-wizard__body';
		el.appendChild( body );

		const update = progressBar( body );

		cancelled = false;

		const findings: Finding[] = [];
		let offset = 0;
		let total = 0;

		try {
			for ( ;; ) {
				if ( cancelled || ! panel ) {
					return;
				}

				const chunk = await scanChunk( offset );

				findings.push( ...chunk.findings );
				total = chunk.total;
				update( Math.min( offset + 25, total ), total, `${ Math.min( offset + 25, total ) } of ${ total } files read` );

				if ( chunk.next < 0 ) {
					break;
				}

				offset = chunk.next;
			}
		} catch ( error ) {
			body.appendChild(
				noticeEl( error instanceof Error ? error.message : 'The scan failed part-way.', 'warning' )
			);

			return;
		}

		setFindingsBadge( findings.length );
		showFindings( findings );
	};

	/* ------------------------------------------------------------------ *
	 * Step 3 — findings and remedies.
	 * ------------------------------------------------------------------ */

	const showFindings = ( findings: Finding[] ) => {
		const el = shellPanel();

		header( el, 'What the scan found', 1 );

		const body = document.createElement( 'div' );

		body.className = 'atme-wizard__body';
		el.appendChild( body );

		const byKind = ( kind: Finding[ 'kind' ] ) => findings.filter( ( finding ) => finding.kind === kind );
		const oversized = byKind( 'oversized' );
		const legacy = byKind( 'legacy-format' );
		const missingAlt = byKind( 'missing-alt' );
		const duplicates = byKind( 'duplicate' );
		const missingFiles = byKind( 'missing-file' );

		if ( findings.length === 0 ) {
			body.appendChild(
				emptyStateEl( {
					title: 'Nothing to fix',
					body: 'Every image is sized sensibly, formatted modern, and described.',
					icon: 'dashicons-yes-alt',
				} )
			);

			return;
		}

		const choices: RemedyChoices = {
			convertLegacy: legacy.length > 0,
			format: getConfig().conversion.encode.webp ? 'webp' : 'jpeg',
			quality: 82,
			downscale: oversized.length > 0,
			maxWidth: 2560,
		};

		const card = ( title: string, count: number ): HTMLElement => {
			const box = document.createElement( 'div' );

			box.className = 'atme-wizard__card';

			const heading = document.createElement( 'h3' );

			heading.textContent = `${ title } — ${ count }`;
			box.appendChild( heading );
			body.appendChild( box );

			return box;
		};

		if ( legacy.length > 0 ) {
			const box = card( 'Legacy formats', legacy.length );

			box.appendChild(
				checkboxControl( {
					label: `Convert to ${ choices.format.toUpperCase() } in place (originals kept as versions)`,
					checked: choices.convertLegacy,
					onChange: ( checked ) => {
						choices.convertLegacy = checked;
					},
				} )
			);
			box.appendChild(
				rangeControl( {
					label: 'Quality',
					value: choices.quality,
					min: 40,
					max: 100,
					onChange: ( value ) => {
						choices.quality = value;
					},
				} )
			);
		}

		if ( oversized.length > 0 ) {
			const box = card( 'Oversized images', oversized.length );

			box.appendChild(
				checkboxControl( {
					label: `Downscale to ${ choices.maxWidth }px wide, in place`,
					checked: choices.downscale,
					onChange: ( checked ) => {
						choices.downscale = checked;
					},
				} )
			);
		}

		if ( missingAlt.length > 0 ) {
			const box = card( 'Missing alt text', missingAlt.length );

			box.appendChild(
				noticeEl( 'Alt text needs eyes. The “Missing alt text” smart view lists these for writing — or the AI assist in the inspector drafts one per image.' )
			);
		}

		if ( duplicates.length > 0 ) {
			const box = card( 'Duplicate files', duplicates.length );

			box.appendChild(
				noticeEl( 'Duplicates are never auto-deleted. The “Duplicates” smart view shows each group side by side for a human decision.' )
			);
		}

		if ( missingFiles.length > 0 ) {
			const box = card( 'Missing files', missingFiles.length );

			box.appendChild(
				noticeEl( 'These items exist in the library but their files are gone from disk.', 'warning' )
			);
		}

		const actions = document.createElement( 'div' );

		actions.className = 'atme-wizard__actions';
		actions.appendChild(
			buttonControl( {
				label: 'Apply the selected fixes',
				variant: 'primary',
				className: 'atme-button atme-button--primary',
				onClick: () => {
					const queue: WizardState[ 'queue' ] = [];

					if ( choices.convertLegacy ) {
						for ( const finding of legacy ) {
							queue.push( {
								id: finding.id,
								remedy: 'convert',
								format: choices.format,
								quality: choices.quality,
							} );
						}
					}

					if ( choices.downscale ) {
						for ( const finding of oversized ) {
							queue.push( {
								id: finding.id,
								remedy: 'downscale',
								maxWidth: choices.maxWidth,
								// A downscale keeps the file's own format.
								format: formatFromMime( finding.mime ),
							} );
						}
					}

					if ( queue.length === 0 ) {
						getShell()?.showToast?.( { message: 'Nothing selected to fix' } );

						return;
					}

					void runQueue( { queue, done: 0, failed: [] } );
				},
			} )
		);
		el.appendChild( actions );
	};

	/* ------------------------------------------------------------------ *
	 * Step 4 — the batch.
	 * ------------------------------------------------------------------ */

	const runQueue = async ( state: WizardState ) => {
		const el = shellPanel();

		header( el, 'Fixing…', 2 );

		const body = document.createElement( 'div' );

		body.className = 'atme-wizard__body';
		el.appendChild( body );

		const update = progressBar( body );

		const pause = buttonControl( {
			label: 'Pause (resumable later)',
			className: 'atme-button',
			onClick: () => {
				cancelled = true;
			},
		} );

		body.appendChild( pause );

		cancelled = false;

		while ( state.done < state.queue.length ) {
			if ( cancelled || ! panel ) {
				await saveWizardState( state );

				return;
			}

			const job = state.queue[ state.done ];

			update( state.done, state.queue.length, `${ state.done } of ${ state.queue.length } fixed` );

			try {
				if ( 'convert' === job.remedy ) {
					await convertMedia( job.id, {
						format: job.format ?? 'webp',
						quality: job.quality ?? 82,
						replace: true,
					} );
				} else if ( 'downscale' === job.remedy ) {
					await convertMedia( job.id, {
						// Same format, smaller canvas — "convert" is also the
						// resize verb, which keeps one server code path.
						format: formatOfId( job ),
						quality: 92,
						max_width: job.maxWidth ?? 2560,
						replace: true,
					} );
				} else if ( 'alt' === job.remedy ) {
					await updateMedia( job.id, { alt_text: '' } );
				}
			} catch ( error ) {
				state.failed.push( {
					id: job.id,
					message: error instanceof Error ? error.message : 'failed',
				} );
			}

			state.done += 1;

			// Every five jobs the state lands server-side, so a closed window
			// costs at most four repeats.
			if ( state.done % 5 === 0 ) {
				await saveWizardState( state ).catch( () => undefined );
			}
		}

		await saveWizardState( null ).catch( () => undefined );
		setFindingsBadge( 0 );
		onLibraryChanged();
		showReport( state );
	};

	/** The format a downscale keeps: recorded on the job when it was queued. */
	const formatOfId = ( job: WizardState[ 'queue' ][ number ] ): string => {
		return job.format ?? 'jpeg';
	};

	/* ------------------------------------------------------------------ *
	 * Step 5 — the report.
	 * ------------------------------------------------------------------ */

	const showReport = ( state: WizardState ) => {
		const el = shellPanel();

		header( el, 'Done', 3 );

		const body = document.createElement( 'div' );

		body.className = 'atme-wizard__body';
		el.appendChild( body );

		const fixed = state.done - state.failed.length;

		body.appendChild(
			emptyStateEl( {
				title: `${ fixed } file${ fixed === 1 ? '' : 's' } improved`,
				body: state.failed.length > 0 ? `${ state.failed.length } could not be fixed.` : 'Every selected fix landed.',
				icon: 'dashicons-yes-alt',
			} )
		);

		if ( state.failed.length > 0 ) {
			const list = document.createElement( 'ul' );

			list.className = 'atme-wizard__failures';

			for ( const failure of state.failed.slice( 0, 20 ) ) {
				const row = document.createElement( 'li' );

				row.textContent = `#${ failure.id }: ${ failure.message }`;
				list.appendChild( row );
			}

			body.appendChild( list );
		}

		getShell()?.showToast?.( { message: `Wizard finished — ${ fixed } files improved` } );

		const actions = document.createElement( 'div' );

		actions.className = 'atme-wizard__actions';
		actions.appendChild(
			buttonControl( {
				label: 'Close',
				variant: 'primary',
				className: 'atme-button atme-button--primary',
				onClick: close,
			} )
		);
		el.appendChild( actions );
	};

	return {
		open: () => void showIntro(),
		close,
		destroy: close,
	};
}
