import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

function resolvePackageAsset(packageName: string, candidates: readonly string[], label: string): string {
	for (const candidate of candidates) {
		try {
			return require.resolve(candidate);
		} catch {
			// Try the next candidate.
		}
	}

	try {
		const packageEntry = require.resolve(packageName);
		const packageRoot = dirname(dirname(packageEntry));
		for (const candidate of candidates) {
			const fallbackPath = join(packageRoot, candidate.split('/').slice(1).join('/'));
			if (existsSync(fallbackPath)) {
				return fallbackPath;
			}
		}
	} catch {
		// Fall through to the error below.
	}

	throw new Error(`Unable to resolve ${label} asset. Tried: ${candidates.join(', ')}`);
}

export const VENDOR_BASE_PATH = '/vendor';
export const GSAP_ROUTE = `${VENDOR_BASE_PATH}/gsap.min.js`;
export const PETITE_VUE_ROUTE = `${VENDOR_BASE_PATH}/petite-vue.js`;

export const GSAP_SOURCE_PATH = resolvePackageAsset('gsap', ['gsap/dist/gsap.min.js'], 'GSAP');
export const PETITE_VUE_SOURCE_PATH = resolvePackageAsset(
	'petite-vue',
	[
		'petite-vue/dist/petite-vue.iife.js',
		'petite-vue/dist/petite-vue.iife.prod.js'
	],
	'petite-vue'
);

export function readVendorAsset(pathname: string): { contentType: string; body: string } | null {
	if (pathname === GSAP_ROUTE) {
		return {
			contentType: 'text/javascript; charset=utf-8',
			body: readFileSync(GSAP_SOURCE_PATH, 'utf8')
		};
	}

	if (pathname === PETITE_VUE_ROUTE) {
		return {
			contentType: 'text/javascript; charset=utf-8',
			body: readFileSync(PETITE_VUE_SOURCE_PATH, 'utf8')
		};
	}

	return null;
}
