/** Inline naming form using the shell's controls, with retryable save feedback. */
import { buttonControl, textControl } from './os-ui';

export interface NameForm {
	element: HTMLFormElement;
	readonly busy: boolean;
	focus(): void;
	destroy(): void;
}

export function createNameForm( opts: {
	label: string;
	destination: string;
	value?: string;
	submitLabel: string;
	onSave: ( name: string ) => Promise< void >;
	onClose: () => void;
} ): NameForm {
	const form = document.createElement( 'form' );
	form.className = 'atme-name-form';
	form.setAttribute( 'aria-label', opts.label );
	let value = opts.value ?? '';
	let busy = false;
	let disposed = false;
	const destination = document.createElement( 'p' );
	destination.textContent = opts.destination;
	const field = textControl( { label: opts.label, value, onInput: ( next ) => { value = next; } } );
	const status = document.createElement( 'div' );
	status.setAttribute( 'role', 'status' );
	status.setAttribute( 'aria-live', 'polite' );
	const focus = () => ( field.shadowRoot?.querySelector< HTMLElement >( 'input' ) ?? field ).focus();
	const setBusy = ( next: boolean ) => {
		busy = next;
		form.setAttribute( 'aria-busy', String( next ) );
		for ( const control of [ field, submit, cancel ] ) {
			control.toggleAttribute( 'disabled', next );
		}
		submit.textContent = next ? 'Saving…' : opts.submitLabel;
	};
	const save = async () => {
		if ( busy || disposed ) { return; }
		if ( ! value.trim() ) {
			status.textContent = 'Please enter a name.';
			focus();
			return;
		}
		setBusy( true );
		status.textContent = 'Saving…';
		try {
			await opts.onSave( value.trim() );
			if ( ! disposed ) { opts.onClose(); }
		} catch ( error ) {
			if ( ! disposed ) {
				status.textContent = error instanceof Error ? error.message : 'Could not save. Try again.';
			}
		} finally {
			if ( ! disposed ) { setBusy( false ); }
		}
	};
	const submit = buttonControl( { label: opts.submitLabel, variant: 'primary', onClick: () => void save() } );
	const cancel = buttonControl( { label: 'Cancel', onClick: () => { if ( ! busy ) { opts.onClose(); } } } );
	const actions = document.createElement( 'div' );
	actions.className = 'atme-name-form__actions';
	actions.append( submit, cancel );
	form.append( destination, field, actions, status );
	form.addEventListener( 'submit', ( event ) => { event.preventDefault(); void save(); } );
	form.addEventListener( 'keydown', ( event ) => {
		if ( event.key === 'Escape' ) {
			event.preventDefault(); event.stopPropagation();
			if ( ! busy ) { opts.onClose(); }
		} else if ( event.key === 'Enter' && event.composedPath().includes( field ) ) {
			event.preventDefault(); event.stopPropagation(); void save();
		}
	} );
	return { element: form, get busy() { return busy; }, focus, destroy: () => { disposed = true; form.remove(); } };
}
