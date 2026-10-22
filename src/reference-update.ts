/**
 * After a conversion: point the posts that used the old file at the new one.
 *
 * Converting changes a URL either way — a copy is a new attachment, and an
 * in-place conversion swaps the extension — so every post embedding the old
 * file is left naming it. This offers to fix that, then does it in front of
 * the reader: one post per request, each row in the dialog moving from
 * waiting to updated (or failed, with the server's reason) as it lands.
 *
 * Sequential on purpose, for the same reason bulk convert is: every update is
 * a `wp_update_post()` with its revision and save hooks, and a burst of them
 * is how a shared host falls over mid-batch. Stopping is graceful — the post
 * in flight finishes, the rest are marked skipped.
 */

import { fetchReferenceCandidates, updatePostReferences } from './api';
import { buttonControl, ensureComponents, modalControl, progressControl, registered, type Modal } from './os-ui';
import type { UsageRow } from './types';

/** One conversion whose posts may need moving. */
export interface ConversionPair {
	/** The attachment posts use now. */
	from: number;
	/** The converted attachment; `from` itself after an in-place conversion. */
	to: number;
}

/** The handle a caller keeps so window teardown can close the dialog. */
export interface ReferenceUpdate {
	/** Closes the dialog and ignores every answer still in flight. */
	destroy(): void;
}

type JobStatus = 'pending' | 'working' | 'done' | 'unchanged' | 'failed' | 'skipped';

interface Job {
	postId: number;
	title: string;
	type: string;
	typeLabel: string;
	pairs: ConversionPair[];
	status: JobStatus;
	detail: string;
	row?: HTMLElement;
}

const GLYPHS: Record< JobStatus, string > = {
	pending: '○',
	working: '…',
	done: '✓',
	unchanged: '–',
	failed: '!',
	skipped: '–',
};

/** How formats are written in prose; the slug is a machine word. */
const FORMAT_NAMES: Record< string, string > = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP', avif: 'AVIF', gif: 'GIF' };

const plural = ( count: number, one: string, many = `${ one }s` ) => `${ count } ${ count === 1 ? one : many }`;

/**
 * Gathers the posts each conversion left behind, one job per post.
 *
 * A post using two of a bulk conversion's files is one row with two pairs,
 * not two rows the reader would have to reconcile. A pair whose lookup fails
 * contributes nothing — the conversion already succeeded, and an offer with
 * fewer posts beats no offer at all.
 */
async function collectJobs( pairs: ConversionPair[] ): Promise< Job[] > {
	const lookups = await Promise.all(
		pairs.map( ( pair ) =>
			fetchReferenceCandidates( pair.from, pair.to )
				.then( ( rows ) => ( { pair, rows } ) )
				.catch( () => ( { pair, rows: [] as UsageRow[] } ) )
		)
	);

	const jobs = new Map< number, Job >();

	for ( const { pair, rows } of lookups ) {
		for ( const row of rows ) {
			if ( row.postId <= 0 ) {
				continue;
			}

			const job = jobs.get( row.postId ) ?? {
				postId: row.postId,
				title: row.title || `#${ row.postId }`,
				type: row.type,
				typeLabel: row.typeLabel,
				pairs: [],
				status: 'pending' as JobStatus,
				detail: 'Waiting',
			};

			job.pairs.push( pair );
			jobs.set( row.postId, job );
		}
	}

	return [ ...jobs.values() ];
}

/**
 * Offers to update the posts a conversion left pointing at the old file.
 *
 * Returns at once; the lookup runs behind it and the dialog opens only when
 * there is something to update, so a file nobody embeds converts with no
 * extra prompt at all.
 *
 * @param opts.pairs      The conversions that just finished.
 * @param opts.format     The target format, for the copy.
 * @param opts.onFinished Called once a run ends with at least one post written.
 */
export function offerReferenceUpdate( opts: {
	pairs: ConversionPair[];
	format: string;
	onFinished?: () => void;
} ): ReferenceUpdate {
	let disposed = false;
	let modal: Modal | null = null;

	const handle: ReferenceUpdate = {
		destroy: () => {
			disposed = true;
			modal?.close();
			modal = null;
		},
	};

	if ( opts.pairs.length === 0 ) {
		return handle;
	}

	const open = ( jobs: Job[] ) => {
		const format = FORMAT_NAMES[ opts.format ] ?? opts.format.toUpperCase();
		let stopping = false;
		let wrote = false;

		modal = modalControl( {
			title: `Use the ${ format } in your posts?`,
			className: 'atme-refupdate',
			onCancel: () => {
				modal = null;
				disposed = true;
			},
		} );

		const { body, footer } = modal;

		const intro = document.createElement( 'p' );

		intro.className = 'atme-refupdate__intro';
		intro.textContent =
			( opts.pairs.length === 1
				? `This image is used in ${ plural( jobs.length, 'post' ) }, which still point at the old file. `
				: `These images are used in ${ plural( jobs.length, 'post' ) }, which still point at the old files. ` ) +
			`Update ${ jobs.length === 1 ? 'it' : 'them' } to the new ${ format }? Posts that keep revisions get a new one, so each change can be undone.`;
		body.appendChild( intro );

		const progress = progressControl( 'Posts updated' );
		const progressWrap = document.createElement( 'div' );
		const live = document.createElement( 'div' );

		progressWrap.className = 'atme-refupdate__progress';
		progressWrap.hidden = true;
		progressWrap.appendChild( progress.el );
		body.appendChild( progressWrap );

		// Inside the progress block, so the offer has no empty line in it.
		live.className = 'atme-refupdate__status';
		live.setAttribute( 'role', 'status' );
		live.setAttribute( 'aria-live', 'polite' );
		progressWrap.appendChild( live );

		const list = document.createElement( 'ul' );

		list.className = 'atme-refupdate__list';
		body.appendChild( list );

		const paintRow = ( job: Job ) => {
			const row = job.row ?? document.createElement( 'li' );

			job.row = row;
			row.className = 'atme-refupdate__row';
			row.dataset.status = job.status;
			row.textContent = '';

			const glyph = document.createElement( 'span' );

			glyph.className = 'atme-refupdate__glyph';
			glyph.setAttribute( 'aria-hidden', 'true' );

			if ( 'working' === job.status && registered( 'os-spinner' ) ) {
				const spinner = document.createElement( 'os-spinner' );

				spinner.setAttribute( 'size', 'small' );
				glyph.appendChild( spinner );
			} else {
				glyph.textContent = GLYPHS[ job.status ];
			}

			const name = document.createElement( 'span' );

			name.className = 'atme-refupdate__name';
			name.textContent = job.title;

			const type = document.createElement( 'span' );

			type.className = 'atme-refupdate__type';
			type.textContent = job.typeLabel;

			const detail = document.createElement( 'span' );

			detail.className = 'atme-refupdate__detail';
			detail.textContent = job.detail;

			row.append( glyph, name, type, detail );

			return row;
		};

		for ( const job of jobs ) {
			list.appendChild( paintRow( job ) );
		}

		const paintFooter = ( phase: 'offer' | 'running' | 'finished' ) => {
			footer.textContent = '';

			if ( 'offer' === phase ) {
				footer.append(
					buttonControl( {
						label: 'Not now',
						className: 'atme-button',
						onClick: () => handle.destroy(),
					} ),
					buttonControl( {
						label: `Update ${ plural( jobs.length, 'post' ) }`,
						variant: 'primary',
						className: 'atme-button atme-button--primary',
						onClick: () => void run( jobs ),
					} )
				);

				return;
			}

			if ( 'running' === phase ) {
				const stop = buttonControl( {
					label: 'Stop',
					className: 'atme-button',
					onClick: () => {
						stopping = true;
						stop.textContent = 'Stopping…';
						stop.setAttribute( 'disabled', '' );
					},
				} );

				footer.appendChild( stop );

				return;
			}

			const failed = jobs.filter( ( job ) => 'failed' === job.status );

			if ( failed.length > 0 ) {
				footer.appendChild(
					buttonControl( {
						label: `Retry ${ plural( failed.length, 'failed post' ) }`,
						className: 'atme-button',
						onClick: () => void run( failed ),
					} )
				);
			}

			footer.appendChild(
				buttonControl( {
					label: 'Done',
					variant: 'primary',
					className: 'atme-button atme-button--primary',
					onClick: () => handle.destroy(),
				} )
			);
		};

		const summarize = () => {
			const count = ( status: JobStatus ) => jobs.filter( ( job ) => status === job.status ).length;
			const parts = [ `${ plural( count( 'done' ), 'post' ) } updated` ];

			if ( count( 'unchanged' ) ) {
				parts.push( `${ count( 'unchanged' ) } already up to date` );
			}

			if ( count( 'failed' ) ) {
				parts.push( `${ count( 'failed' ) } failed` );
			}

			if ( count( 'skipped' ) ) {
				parts.push( `${ count( 'skipped' ) } skipped` );
			}

			return parts.join( ' · ' );
		};

		const run = async ( queue: Job[] ) => {
			stopping = false;
			intro.hidden = true;
			progressWrap.hidden = false;
			modal?.setMandatory( true );
			paintFooter( 'running' );

			for ( const job of queue ) {
				job.status = 'pending';
				job.detail = 'Waiting';
				paintRow( job );
			}

			for ( const [ index, job ] of queue.entries() ) {
				if ( disposed ) {
					return;
				}

				if ( stopping ) {
					job.status = 'skipped';
					job.detail = 'Skipped';
					paintRow( job );
					continue;
				}

				progress.set( index, queue.length );
				live.textContent = `Updating ${ index + 1 } of ${ queue.length }: ${ job.title }`;
				job.status = 'working';
				job.detail = 'Updating…';
				paintRow( job ).scrollIntoView?.( { block: 'nearest' } );

				let replaced = 0;
				let featured = false;
				let changed = false;

				try {
					for ( const pair of job.pairs ) {
						const result = await updatePostReferences( job.postId, pair.from, pair.to, job.type );

						if ( disposed ) {
							return;
						}

						replaced += result.replaced;
						featured = featured || result.featured;
						changed = changed || result.changed;
					}

					wrote = wrote || changed;
					job.status = changed ? 'done' : 'unchanged';
					job.detail = changed
						? [ replaced > 0 ? `${ plural( replaced, 'link' ) } updated` : '', featured ? 'featured image' : '' ]
								.filter( Boolean )
								.join( ' · ' ) || 'Updated'
						: 'Already up to date';
				} catch ( error ) {
					if ( disposed ) {
						return;
					}

					job.status = 'failed';
					job.detail = error instanceof Error ? error.message : 'Could not be updated';
				}

				paintRow( job );
			}

			progress.set( queue.length, queue.length );
			live.textContent = summarize();
			modal?.setMandatory( false );
			paintFooter( 'finished' );

			if ( wrote ) {
				opts.onFinished?.();
			}
		};

		paintFooter( 'offer' );
	};

	void ( async () => {
		const jobs = await collectJobs( opts.pairs );

		if ( disposed || jobs.length === 0 ) {
			return;
		}

		await ensureComponents( [ 'os-modal', 'os-button', 'os-progress-bar', 'os-spinner' ] );

		if ( ! disposed ) {
			open( jobs );
		}
	} )();

	return handle;
}
