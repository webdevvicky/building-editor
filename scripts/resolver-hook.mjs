// Minimal Node ESM loader hook: append .js to extension-less relative specifiers.
// Used by scripts/verify-boq.mjs to run Vite-style imports in plain Node.

import { fileURLToPath } from 'node:url'
import { existsSync, statSync } from 'node:fs'
import { extname, dirname, resolve as pathResolve } from 'node:path'

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && !extname(specifier)) {
    const parentPath = fileURLToPath(context.parentURL)
    const parentDir  = dirname(parentPath)
    const fullPath   = pathResolve(parentDir, specifier)
    if (existsSync(fullPath + '.js')) {
      return nextResolve(specifier + '.js', context)
    }
    if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
      if (existsSync(pathResolve(fullPath, 'index.js'))) {
        return nextResolve(specifier + '/index.js', context)
      }
    }
  }
  return nextResolve(specifier, context)
}
