/* eslint-disable no-console */
import process from 'node:process'
import fs from 'node:fs/promises'

const LOADER = process.env.IMPORTX_LOADER || 'auto'
const barPath = new URL('./bar.mts', import.meta.url)
const barContent = await fs.readFile(barPath, 'utf8')

const output = {
  loader: LOADER,
  import: false,
  importNoCache: false,
  importCache: false,
}

try {
  const run1noCache = await import('../../dist/index.mjs')
    .then(x => x.import('./foo.mts', {
      loader: LOADER,
      cache: false,
      parentURL: import.meta.url,
      ignoreImportxWarning: true,
    }))

  const run1cache = await import('../../dist/index.mjs')
    .then(x => x.import('./foo.mts', {
      loader: LOADER,
      cache: true,
      parentURL: import.meta.url,
      ignoreImportxWarning: true,
    }))

  await fs.writeFile(barPath, 'export const bar = "newBar"', 'utf8')

  output.import = run1noCache.default === 'Foo42bar42'

  const run2noCache = await import('../../dist/index.mjs')
    .then(x => x.import('./foo.mts', {
      loader: LOADER,
      cache: false,
      parentURL: import.meta.url,
      ignoreImportxWarning: true,
    }))

  const run2cache = await import('../../dist/index.mjs')
    .then(x => x.import('./foo.mts', {
      loader: LOADER,
      cache: true,
      parentURL: import.meta.url,
      ignoreImportxWarning: true,
    }))

  output.importNoCache = run2noCache.default !== run1noCache.default
  output.importCache = run2cache === run1cache
}
finally {
  await fs.writeFile(barPath, barContent, 'utf8')
}

console.log(JSON.stringify(output, null, 2))

if (!output.import)
  process.exitCode = 1
