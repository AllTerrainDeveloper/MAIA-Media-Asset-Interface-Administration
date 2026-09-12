/** PNG width and height from the mandatory IHDR chunk. */
export function pngSize( bytes: Buffer ): [ number, number ];
/** Validates listing assets and returns their filenames. */
export function checkDirectoryAssets( root: string ): string[];
