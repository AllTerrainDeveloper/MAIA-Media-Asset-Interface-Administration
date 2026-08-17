/**
 * Vite asset-import shims the compiler needs and the bundler resolves.
 */

declare module '*?url' {
	const url: string;

	export default url;
}

declare module '@jsquash/avif/codec/enc/avif_enc.js' {
	const factory: ( opts: object ) => Promise< unknown >;

	export default factory;
}
