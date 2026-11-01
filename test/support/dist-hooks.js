// Resolve hooks for npm run test:dist and test:min. SOUCOUYANT_DIST=min swaps
// in soucouyant-core.min.js and soucouyant-temporal.min.js, including where
// the built bindings import the unminified files, so a run never loads two
// copies of the core.
const source = new URL('../../src/', import.meta.url).href
const dist = new URL('../../dist/js/', import.meta.url).href
const minified = process.env.SOUCOUYANT_DIST === 'min'

const libraryFiles = ['soucouyant-core.js', 'soucouyant-temporal.js', 'soucouyant-polychrony.js']
const libraryUrl = (path) => dist + (minified ? path.replace(/\.js$/, '.min.js') : path)

export const resolve = async (specifier, context, nextResolve) => {
  const resolved = await nextResolve(specifier, context)
  if (resolved.url.startsWith(dist)) {
    const path = resolved.url.slice(dist.length)
    return libraryFiles.includes(path) ? { ...resolved, url: libraryUrl(path) } : resolved
  }
  if (!resolved.url.startsWith(source)) return resolved
  const path = resolved.url.slice(source.length)
  if (libraryFiles.includes(path)) return { ...resolved, url: libraryUrl(path) }
  if (path.startsWith('bindings/') || path.startsWith('storage/')) return { ...resolved, url: dist + path }
  return resolved
}
