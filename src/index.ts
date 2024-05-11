/* eslint-disable node/prefer-global/process */

import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import Debug from 'debug'

const debug = Debug('importx')

type ArgumentTypes<T> = T extends (...args: infer U) => any ? U : never

export type SupportedLoader = 'tsx' | 'jiti' | 'bundle-require' | 'native'

export interface ImportTsOptions {
  /**
   * Loader to use for importing the file.
   * @default 'auto'
   */
  loader?: SupportedLoader | 'auto'
  /**
   * Options for each loader
   * Only the loader that is used will be applied.
   */
  loaderOptions?: {
    /**
     * Options for `tsx` loader.
     *
     * @see https://tsx.is/node#tsimport
     */
    tsx?: Omit<Partial<Exclude<ArgumentTypes<typeof import('tsx/esm/api').tsImport>['1'], string>>, 'parentURL'>
    /**
     * Options for `jiti` loader.
     *
     * @default { esmResolve: true }
     * @see https://github.com/unjs/jiti#options
     */
    jiti?: import('jiti').JITIOptions
    /**
     * Options for `bundle-require` loader.
     *
     * @see https://github.com/egoist/bundle-require
     * @see https://www.jsdocs.io/package/bundle-require#Options
     */
    bundleRequire?: Omit<Partial<import('bundle-require').Options>, 'filepath' | 'cwd'>
  }
  /**
   * Whether to cache the imported module.
   *
   * Setting to `null` means it doesn't matter for you.
   *
   * By the spec of ESM, modules are always cached.
   *
   * Meaning that if you want to re-import a module without cache,
   * you can't use native ESM import.
   *
   * `cache: false` does not compatible with following loaders:
   *  - `native`
   *
   * `cache: true` does not compatible with following loaders:
   *  - `tsx`
   *  - `bundle-require`
   *
   * When `false` is passed, the `auto` mode will fallback to `tsx`
   * for all files include non-TypeScript files.
   *
   * @default null
   */
  cache?: boolean | null
  /**
   * Bypass the `importx` options validation and import anyway.
   *
   * The final behavior is determined by the loader and might not always work as your configuration.
   *
   * @default false
   */
  ignoreImportxWarning?: boolean
  /**
   * The URL of the parent module.
   * Usually you pass `import.meta.url` or `__filename` of the module you are doing the importing.
   */
  parentURL: string | URL
  /**
   * The `with` option for native `import()` call.
   *
   * @see https://github.com/tc39/proposal-import-attributes#dynamic-import
   */
  with?: ImportCallOptions['with']
}

let _isNativeTsImportSupported: boolean | undefined

/**
 * Import a tiny TypeScript module to verify if native TypeScript import is supported.
 */
export async function isNativeTsImportSupported(): Promise<boolean> {
  if (_isNativeTsImportSupported === undefined) {
    try {
      const modName = 'dummy.mts'
      const mod = await import(`../${modName}`)
      _isNativeTsImportSupported = mod.default === 'dummy'
    }
    catch {
      _isNativeTsImportSupported = false
    }
  }
  return _isNativeTsImportSupported
}

const nodeVersionNumbers = globalThis?.process?.versions?.node?.split('.').map(Number)

/**
 * Detect the 'auto' loader to use for importing the file.
 */
async function detectLoader(cache: boolean | null, isTsFile: boolean): Promise<SupportedLoader> {
  if (cache === false)
    return tsxOrJiti()

  if (!isTsFile || await isNativeTsImportSupported())
    return 'native'

  if (cache === true)
    return 'jiti'

  return tsxOrJiti()
}

async function tsxOrJiti() {
  if (!nodeVersionNumbers)
    return 'tsx'

  /**
   * tsx is supported in Node.js 18.19.0+ and 20.8.0+
   * Otherwise we fallback to jiti
   *
   * @see https://nodejs.org/api/module.html#moduleregisterspecifier-parenturl-options
   */
  if (
    nodeVersionNumbers[0] < 18
    || (nodeVersionNumbers[0] === 18 && nodeVersionNumbers[1] < 19)
    || (nodeVersionNumbers[0] === 20 && nodeVersionNumbers[1] < 8)
  )
    return 'jiti'

  return 'tsx'
}

const reIsTypeScriptFile = /\.[mc]?tsx?$/

export function isTypeScriptFile(path: string) {
  return reIsTypeScriptFile.test(path)
}

/**
 * Import a TypeScript module at runtime.
 *
 * @param path The path to the file to import.
 * @param parentURL The URL of the parent module, usually `import.meta.url` or `__filename`.
 */
export async function importTs<T = any>(path: string, parentURL: string | URL): Promise<T>
/**
 * Import a TypeScript module at runtime.
 *
 * @param path The path to the file to import.
 * @param options Options
 */
export async function importTs<T = any>(path: string, options: ImportTsOptions): Promise<T>
export async function importTs<T = any>(path: string, options: string | URL | ImportTsOptions): Promise<T> {
  if (typeof options === 'string' || options instanceof URL)
    options = { parentURL: options }

  const {
    loaderOptions = {},
    parentURL,
    cache = true,
    ignoreImportxWarning = false,
    ...otherOptions
  } = options

  let loader = options.loader || 'auto'
  if (loader === 'auto')
    loader = await detectLoader(cache, isTypeScriptFile(path))

  debug(`[${loader}]`, 'Importing', path, 'from', parentURL)

  switch (loader) {
    case 'native': {
      if (cache === false && !ignoreImportxWarning)
        throw new Error('`cache: false` is not compatible with `native` loader')

      return import(
        path[0] === '.'
          ? fileURLToPath(new URL(path, parentURL))
          : path,
        otherOptions
      )
    }

    case 'tsx': {
      if (cache === true && !ignoreImportxWarning)
        throw new Error('`cache: true` is not compatible with `tsx` loader')

      return import('tsx/esm/api')
        .then(r => r.tsImport(
          path,
          {
            ...loaderOptions.tsx,
            parentURL: fileURLToPath(parentURL),
          },
        ))
    }

    case 'jiti': {
      return import('jiti')
        .then(r => r.default(fileURLToPath(parentURL), {
          esmResolve: true,
          ...(options.cache === false
            ? {
                cache: false,
                requireCache: false,
              }
            : {}),
          ...loaderOptions.jiti,
        })(path))
    }

    case 'bundle-require': {
      if (cache === true && !ignoreImportxWarning)
        throw new Error('`cache: true` is not compatible with `native` loader')

      return import('bundle-require')
        .then(r => r.bundleRequire({
          ...loaderOptions.bundleRequire,
          filepath: path,
          cwd: dirname(fileURLToPath(parentURL)),
        }))
        .then(r => r.mod)
    }
    default: {
      throw new Error(`Unknown loader: ${loader}`)
    }
  }
}

// Alias for easier import
export { importTs as import }
