import { extname } from 'node:path';
import type { Plugin as VitePlugin } from 'vite';
import { addRollupInput } from '../add-rollup-input.js';
import { type BuildInternals } from '../internal.js';
import type { AstroBuildPlugin } from '../plugin';
import type { StaticBuildOptions } from '../types';
import { MIDDLEWARE_MODULE_ID } from './plugin-middleware.js';
import { RENDERERS_MODULE_ID } from './plugin-renderers.js';

export const ASTRO_PAGE_MODULE_ID = '@astro-page:';
export const ASTRO_PAGE_RESOLVED_MODULE_ID = '\0@astro-page:';

// This is an arbitrary string that we are going to replace the dot of the extension
export const ASTRO_PAGE_EXTENSION_POST_PATTERN = '@_@';

/**
 * 1. We add a fixed prefix, which is used as virtual module naming convention;
 * 2. We replace the dot that belongs extension with an arbitrary string.
 *
 * @param path
 */
export function getVirtualModulePageNameFromPath(path: string) {
	// we mask the extension, so this virtual file
	// so rollup won't trigger other plugins in the process
	const extension = extname(path);
	return `${ASTRO_PAGE_MODULE_ID}${path.replace(
		extension,
		extension.replace('.', ASTRO_PAGE_EXTENSION_POST_PATTERN)
	)}`;
}

function vitePluginPages(opts: StaticBuildOptions, internals: BuildInternals): VitePlugin {
	return {
		name: '@astro/plugin-build-pages',

		options(options) {
			if (opts.settings.config.output === 'static') {
				const inputs: Set<string> = new Set();

				for (const path of Object.keys(opts.allPages)) {
					inputs.add(getVirtualModulePageNameFromPath(path));
				}

				return addRollupInput(options, Array.from(inputs));
			}
		},

		resolveId(id) {
			if (id.startsWith(ASTRO_PAGE_MODULE_ID)) {
				return '\0' + id;
			}
		},

		async load(id) {
			if (id.startsWith(ASTRO_PAGE_RESOLVED_MODULE_ID)) {
				const imports: string[] = [];
				const exports: string[] = [];
				// we remove the module name prefix from id, this will result into a string that will start with "src/..."
				const pageName = id.slice(ASTRO_PAGE_RESOLVED_MODULE_ID.length);
				// We replaced the `.` of the extension with ASTRO_PAGE_EXTENSION_POST_PATTERN, let's replace it back
				const pageData = internals.pagesByComponent.get(
					`${pageName.replace(ASTRO_PAGE_EXTENSION_POST_PATTERN, '.')}`
				);
				if (pageData) {
					const resolvedPage = await this.resolve(pageData.moduleSpecifier);
					if (resolvedPage) {
						imports.push(`const page = () => import(${JSON.stringify(pageData.moduleSpecifier)});`);
						exports.push(`export { page }`);

						imports.push(`import { renderers } from "${RENDERERS_MODULE_ID}";`);
						exports.push(`export { renderers };`);

						if (opts.settings.config.experimental.middleware) {
							imports.push(`import * as _middleware from "${MIDDLEWARE_MODULE_ID}";`);
							exports.push(`export const middleware = _middleware;`);
						}

						return `${imports.join('\n')}${exports.join('\n')}`;
					}
				}
			}
		},
	};
}

export function pluginPages(opts: StaticBuildOptions, internals: BuildInternals): AstroBuildPlugin {
	return {
		build: 'ssr',
		hooks: {
			'build:before': () => {
				return {
					vitePlugin: vitePluginPages(opts, internals),
				};
			},
		},
	};
}
