/**
 * Using the shell's own controls when the shell is there.
 *
 * A raw `<select>` or `<input>` inside OpenStation is not merely plain — it is
 * *wrong*. The shell is a real `wp-admin` document, so WordPress's `forms.css`
 * is loaded and reaches every bare control with a `(0,1,1)` selector
 * (`input[type="text"], select, textarea { background: #fff; color: #1e1e1e }`).
 * That outranks any single class of ours, so a field we had carefully tokenized
 * still renders as a white core-chrome box on a dark window surface.
 *
 * The `<os-*>` components live in shadow DOM, where `forms.css` cannot follow,
 * and they resolve the palette and the active desktop theme themselves. So the
 * board uses them.
 *
 * **Tags, not imports.** Importing from the `openstation` package would pull
 * the whole component kit into a bundle that also has to load on sites with no
 * shell at all — and there is nothing to import *from*: this plugin installs
 * from a zip onto a site that already has OpenStation, so at build time there
 * is no copy of it on disk to resolve against. Emitting the tag is the route
 * that works, and `ensureComponents()` below is what makes the tag real.
 *
 * Every helper here still checks the custom-element registry first and falls
 * back to the native control, because a tag no loaded bundle has registered
 * renders as inert HTML rather than as a control — and that remains possible on
 * the standalone admin page, which has no shell, and on a site running a shell
 * older than `wp.os.loadComponents()`.
 */

/** Whether a custom element is actually defined on this page. */
export function registered( tag: string ): boolean {
	return typeof customElements !== 'undefined' && !! customElements.get( tag );
}

/**
 * The tags this plugin renders when the shell can provide them.
 *
 * Listed rather than inferred, because the list is the argument that lets the
 * loader skip the network: `loadComponents()` with no tags always fetches the
 * kit, while `loadComponents( tags )` returns without a request once they are
 * all registered.
 */
export const COMPONENT_TAGS = [
	'os-select',
	'os-option',
	'os-button',
	'os-text-field',
	'os-textarea',
	'os-checkbox-label',
	'os-range-field',
	'os-notice',
	'os-empty-state',
	'os-progress-bar',
	'os-steps',
	'os-step',
	'os-spinner',
	'os-icon',
	'os-relative-time',
	'os-chip',
] as const;

/**
 * Asks the shell to register the tags we are about to render.
 *
 * Components are side-effect registered per bundle, at import time, so which
 * `<os-*>` tags work on a page is whichever ones the bundles that happened to
 * load imported for their own UI — around 26 of the 64 the shell ships, and a
 * different 26 depending on what it drew. That is why every helper below still
 * checks the registry: the same tag is a real control on one screen and inert
 * markup on another.
 *
 * `wp.os.loadComponents()` closes that gap. It matters most to a plugin shaped
 * like this one: we install from a zip onto a site that already has
 * OpenStation, so there is no path to `import` the classes from at build time,
 * and bundling our own copy would ship a second set of the components the page
 * already has.
 *
 * Guarded on both sides rather than assumed. The API landed after this plugin
 * started using components, so a site can be running an older shell -- and the
 * standalone admin page has no shell at all. Either way this resolves quietly
 * and the helpers fall back to native controls, which is what they did before
 * the API existed.
 *
 * @param tags Tags about to be rendered.
 * @return Whether anything actually upgraded, i.e. whether a re-render is worth
 *         doing. False when the tags were already there, when no shell offers
 *         the API, and when the fetch failed.
 */
export async function ensureComponents(
	tags: readonly string[] = COMPONENT_TAGS
): Promise< boolean > {
	const missing = tags.filter( ( tag ) => ! registered( tag ) );

	// Nothing to gain, and no reason to touch the shell at all.
	if ( ! missing.length ) {
		return false;
	}

	const load = (
		window as unknown as {
			wp?: { os?: { loadComponents?: ( t: readonly string[] ) => Promise< void > } };
		}
	 ).wp?.os?.loadComponents;

	if ( 'function' !== typeof load ) {
		return false;
	}

	try {
		await load( tags );
	} catch {
		// The kit was needed and could not be fetched. The helpers below render
		// native controls, so the board is usable rather than broken; there is
		// nothing here worth interrupting anyone about.
		return false;
	}

	// Only report success for a tag that was missing and now is not. A caller
	// re-rendering on `true` should not be made to do it for nothing.
	return missing.some( ( tag ) => registered( tag ) );
}

export interface Option {
	value: string;
	label: string;
}

/**
 * A select that is `<os-select>` in the shell and a `<select>` outside it.
 *
 * Both report through the same `onChange`, so callers never branch on which one
 * they got.
 */
export function selectControl( opts: {
	label: string;
	value: string;
	options: Option[];
	/** Applied to the native fallback only — never to a component host. */
	className?: string;
	/**
	 * Keep the label for screen readers but off the screen.
	 *
	 * A toolbar is a row of controls read left to right, and stacking a caption
	 * over each one makes them taller than the plain buttons beside them — the
	 * row loses its baseline and the buttons float in the middle of it. The
	 * component reads `label || placeholder` for its accessible name, so
	 * passing the text as the placeholder keeps the control named without
	 * drawing a caption above it.
	 */
	hideLabel?: boolean;
	onChange: ( value: string ) => void;
} ): HTMLElement {
	if ( registered( 'os-select' ) ) {
		const select = document.createElement( 'os-select' );

		select.setAttribute( 'value', opts.value );

		if ( opts.hideLabel ) {
			select.setAttribute( 'placeholder', opts.label );
		} else {
			// The component renders this *and* wires the listbox to it, which
			// is the part a bare `aria-label` on a native select cannot do.
			select.setAttribute( 'label', opts.label );
		}

		// No class of ours on the host: the component owns its whole surface,
		// and our border and radius would layer a second edge over its own.
		for ( const option of opts.options ) {
			const el = document.createElement( 'os-option' );
			el.setAttribute( 'value', option.value );
			el.textContent = option.label;
			select.appendChild( el );
		}

		select.addEventListener( 'os-pick', ( event ) => {
			const value = ( event as CustomEvent< { value?: string } > ).detail?.value;

			if ( typeof value === 'string' ) {
				opts.onChange( value );
			}
		} );

		return select;
	}

	const select = document.createElement( 'select' );
	select.className = opts.className ?? '';
	select.setAttribute( 'aria-label', opts.label );

	for ( const option of opts.options ) {
		const el = document.createElement( 'option' );
		el.value = option.value;
		el.textContent = option.label;
		select.appendChild( el );
	}

	select.value = opts.value;
	select.addEventListener( 'change', () => opts.onChange( select.value ) );

	return select;
}

/**
 * A button that is `<os-button>` in the shell and a `<button>` outside it.
 *
 * For plain actions only. A **toggle** wants a native button: `<os-button>`
 * renders its real button inside shadow DOM and forwards no ARIA to it, so an
 * `aria-pressed` set on the host is announced to nobody — the state would be
 * visible and unreadable at once.
 *
 * @param variant   Passed through to `<os-button>`.
 * @param className Applied to the native fallback only; see below.
 */
export function buttonControl( opts: {
	label: string;
	variant?: 'primary' | 'secondary' | 'danger';
	className?: string;
	onClick: () => void;
} ): HTMLElement {
	if ( registered( 'os-button' ) ) {
		const button = document.createElement( 'os-button' );

		button.textContent = opts.label;

		if ( opts.variant ) {
			button.setAttribute( 'variant', opts.variant );
		}

		// The caller's class is deliberately *not* applied to the host. The
		// component owns its whole surface — border, radius, and an iridescent
		// hairline that lights on hover — and a border of ours on the host
		// layers a second outline over it, with our corner radius against its
		// own. The result is a doubled edge with notched corners.
		button.addEventListener( 'click', opts.onClick );

		return button;
	}

	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = opts.className ?? 'atme__button';
	button.textContent = opts.label;
	button.addEventListener( 'click', opts.onClick );

	return button;
}

/**
 * A single-line text field, as a component where one exists.
 *
 * Which is to say: the component, once `ensureComponents()` has run. Whether
 * `<os-text-field>` is registered at boot depends on what the shell happened to
 * draw — it is not in the overlay kit that always loads — so before the loader
 * existed this returned a native input on most pages and a component on some,
 * which is exactly why the check is at runtime rather than assumed either way.
 */
export function textControl( opts: {
	label: string;
	value?: string;
	placeholder?: string;
	type?: string;
	className?: string;
	/** As `selectControl` — named for screen readers, uncaptioned on screen. */
	hideLabel?: boolean;
	onInput: ( value: string ) => void;
} ): HTMLElement {
	if ( registered( 'os-text-field' ) ) {
		const field = document.createElement( 'os-text-field' );

		field.setAttribute( 'value', opts.value ?? '' );

		if ( opts.hideLabel ) {
			field.setAttribute( 'aria-label', opts.label );
		} else {
			field.setAttribute( 'label', opts.label );
		}

		if ( opts.placeholder ) {
			field.setAttribute( 'placeholder', opts.placeholder );
		}

		// The component's own event carries the value in `detail`; the bare
		// `input` listener stays as a belt for older builds that forwarded it.
		field.addEventListener( 'os-input-change', ( event ) => {
			const value = ( event as CustomEvent< { value?: string } > ).detail?.value;
			opts.onInput( typeof value === 'string' ? value : '' );
		} );
		field.addEventListener( 'input', ( event ) => {
			const value = ( event.target as { value?: string } ).value;

			if ( typeof value === 'string' ) {
				opts.onInput( value );
			}
		} );

		return field;
	}

	const input = document.createElement( 'input' );
	input.type = opts.type ?? 'text';
	input.className = opts.className ?? '';
	input.setAttribute( 'aria-label', opts.label );
	input.value = opts.value ?? '';

	if ( opts.placeholder ) {
		input.placeholder = opts.placeholder;
	}

	input.addEventListener( 'input', () => opts.onInput( input.value ) );

	return input;
}

/**
 * A multi-line field, `<os-textarea>` in the shell.
 */
export function textareaControl( opts: {
	label: string;
	value?: string;
	className?: string;
	hideLabel?: boolean;
	onInput: ( value: string ) => void;
} ): HTMLElement {
	if ( registered( 'os-textarea' ) ) {
		const field = document.createElement( 'os-textarea' );

		field.setAttribute( 'value', opts.value ?? '' );

		if ( opts.hideLabel ) {
			field.setAttribute( 'aria-label', opts.label );
		} else {
			field.setAttribute( 'label', opts.label );
		}

		field.addEventListener( 'os-input-change', ( event ) => {
			const value = ( event as CustomEvent< { value?: string } > ).detail?.value;
			opts.onInput( typeof value === 'string' ? value : '' );
		} );
		field.addEventListener( 'input', ( event ) => {
			const value = ( event.target as { value?: string } ).value;

			if ( typeof value === 'string' ) {
				opts.onInput( value );
			}
		} );

		return field;
	}

	const wrap = document.createElement( 'label' );
	wrap.className = 'atme-field';

	const caption = document.createElement( 'span' );
	caption.className = 'atme-field__label';
	caption.textContent = opts.label;

	if ( ! opts.hideLabel ) {
		wrap.appendChild( caption );
	}

	const input = document.createElement( 'textarea' );
	input.className = opts.className ?? 'atme-field__input';
	input.setAttribute( 'aria-label', opts.label );
	input.value = opts.value ?? '';
	input.addEventListener( 'input', () => opts.onInput( input.value ) );
	wrap.appendChild( input );

	return wrap;
}

/**
 * A checkbox with its label, `<os-checkbox-label>` in the shell.
 *
 * Both hosts report through `onChange( checked )`.
 */
export function checkboxControl( opts: {
	label: string;
	checked?: boolean;
	onChange: ( checked: boolean ) => void;
} ): HTMLElement {
	if ( registered( 'os-checkbox-label' ) ) {
		const box = document.createElement( 'os-checkbox-label' );

		// The label rides the attribute — the component renders it in shadow
		// DOM; light-DOM text would sit beside the control, unstyled.
		box.setAttribute( 'label', opts.label );

		if ( opts.checked ) {
			box.setAttribute( 'checked', '' );
		}

		box.addEventListener( 'os-checkbox-change', ( event ) => {
			const checked = ( event as CustomEvent< { checked?: boolean } > ).detail?.checked;
			opts.onChange( !! checked );
		} );

		return box;
	}

	const wrap = document.createElement( 'label' );
	wrap.className = 'atme-convert__mode';

	const input = document.createElement( 'input' );
	input.type = 'checkbox';
	input.checked = !! opts.checked;
	input.addEventListener( 'change', () => opts.onChange( input.checked ) );
	wrap.appendChild( input );
	wrap.appendChild( document.createTextNode( ` ${ opts.label }` ) );

	return wrap;
}

/**
 * A slider with a live readout, `<os-range-field>` in the shell.
 */
export function rangeControl( opts: {
	label: string;
	value: number;
	min: number;
	max: number;
	onChange: ( value: number ) => void;
} ): HTMLElement {
	if ( registered( 'os-range-field' ) ) {
		const field = document.createElement( 'os-range-field' );

		field.setAttribute( 'label', opts.label );
		field.setAttribute( 'min', String( opts.min ) );
		field.setAttribute( 'max', String( opts.max ) );
		field.setAttribute( 'value', String( opts.value ) );

		field.addEventListener( 'os-range-change', ( event ) => {
			const value = Number( ( event as CustomEvent< { value?: number } > ).detail?.value );

			if ( ! Number.isNaN( value ) ) {
				opts.onChange( value );
			}
		} );

		return field;
	}

	const wrap = document.createElement( 'div' );
	wrap.className = 'atme-convert';

	const input = document.createElement( 'input' );
	input.type = 'range';
	input.min = String( opts.min );
	input.max = String( opts.max );
	input.value = String( opts.value );
	input.setAttribute( 'aria-label', opts.label );

	const out = document.createElement( 'span' );
	out.className = 'atme-convert__quality';
	out.textContent = String( opts.value );

	input.addEventListener( 'input', () => {
		out.textContent = input.value;
		opts.onChange( Number( input.value ) );
	} );

	wrap.appendChild( input );
	wrap.appendChild( out );

	return wrap;
}

/**
 * An empty-list placeholder, `<os-empty-state>` in the shell.
 */
export function emptyStateEl( opts: { title: string; body?: string; icon?: string } ): HTMLElement {
	if ( registered( 'os-empty-state' ) ) {
		const empty = document.createElement( 'os-empty-state' );

		empty.setAttribute( 'heading', opts.title );

		if ( opts.icon ) {
			empty.setAttribute( 'icon', opts.icon );
		}

		if ( opts.body ) {
			empty.setAttribute( 'description', opts.body );
		}

		return empty;
	}

	const empty = document.createElement( 'div' );
	empty.className = 'atme-empty';

	const title = document.createElement( 'p' );
	title.className = 'atme-empty__title';
	title.textContent = opts.title;
	empty.appendChild( title );

	if ( opts.body ) {
		const body = document.createElement( 'p' );
		body.className = 'atme-empty__body';
		body.textContent = opts.body;
		empty.appendChild( body );
	}

	return empty;
}

/**
 * An inline notice, `<os-notice>` in the shell.
 */
export function noticeEl( message: string, tone: 'info' | 'warning' = 'info' ): HTMLElement {
	if ( registered( 'os-notice' ) ) {
		const notice = document.createElement( 'os-notice' );

		notice.setAttribute( 'tone', tone );
		notice.textContent = message;

		return notice;
	}

	const notice = document.createElement( 'p' );
	notice.className = 'atme-inspector__hint';
	notice.textContent = message;

	return notice;
}
