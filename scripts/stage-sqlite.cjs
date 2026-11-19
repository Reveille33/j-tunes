'use strict'

const fs = require('node:fs')
const path = require('node:path')

/**
 * electron-builder Arch enum values. Only the two prebuilds better-sqlite3
 * ships for macOS are accepted. A universal binary is not produced: the
 * package has separate arm64 and x64 .node files, and lipo'ing them is not
 * reliable.
 */
const ARCH_NAMES = {
  1: 'x64',
  3: 'arm64',
  x64: 'x64',
  arm64: 'arm64'
}

function archName(arch) {
  return ARCH_NAMES[arch] ?? null
}

function prebuildFile(platform, arch) {
  const name = archName(arch)
  if (name == null) {
    throw new Error(`better-sqlite3 has no ${platform} prebuild for arch ${String(arch)}`)
  }
  return `${platform}-${name}.node`
}

/**
 * Point better-sqlite3 at the prebuild for one architecture.
 *
 * The package ships N-API prebuilds and has no install script. binding.js
 * prefers build/Release/better_sqlite3.node when that file exists, so each
 * Mac arch copies its own prebuild there immediately before packaging.
 * npmRebuild stays false: nothing is compiled.
 */
function stageSqlite(moduleRoot, platform, arch) {
  const filename = prebuildFile(platform, arch)
  const source = path.join(moduleRoot, 'prebuilds', filename)
  if (!fs.existsSync(source)) {
    throw new Error(
      `Missing ${path.join('prebuilds', filename)} in better-sqlite3. ` +
        'The npm package ships this prebuild; reinstall dependencies.'
    )
  }

  const releaseDir = path.join(moduleRoot, 'build', 'Release')
  fs.rmSync(path.join(moduleRoot, 'build'), { recursive: true, force: true })
  fs.mkdirSync(releaseDir, { recursive: true })
  const destination = path.join(releaseDir, 'better_sqlite3.node')
  fs.copyFileSync(source, destination)
  return destination
}

async function beforePack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const moduleRoot = path.join(__dirname, '..', 'node_modules', 'better-sqlite3')
  const destination = stageSqlite(moduleRoot, 'darwin', context.arch)
  console.log(`staged better-sqlite3 ${prebuildFile('darwin', context.arch)} -> ${destination}`)
}

module.exports = beforePack
module.exports.beforePack = beforePack
module.exports.archName = archName
module.exports.prebuildFile = prebuildFile
module.exports.stageSqlite = stageSqlite
