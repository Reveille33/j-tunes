import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { seedDemoLibrary } from './seedDemoLibrary.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs', 'screenshots')
const require = createRequire(import.meta.url)

/**
 * Launches the built app against a throwaway library and writes PNGs.
 * On Linux without a display, re-runs itself under xvfb.
 */
async function main(): Promise<void> {
  ensureDisplay()

  const mainFile = join(root, 'out', 'main', 'index.js')
  if (!existsSync(mainFile)) {
    throw new Error('Built app not found at out/main/index.js. Run npm run build first.')
  }

  mkdirSync(outDir, { recursive: true })
  const userData = join(tmpdir(), `jtunes-shots-${process.pid}`)
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })
  seedDemoLibrary(userData)

  const env = { ...process.env, JTUNES_USER_DATA: userData }
  delete env.ELECTRON_RENDERER_URL

  let app: ElectronApplication | null = null
  try {
    app = await electron.launch({
      executablePath: require('electron') as string,
      cwd: root,
      args: [root, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      env,
      timeout: 60_000
    })

    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.setContentSize(1280, 800)
    })
    await page.getByText('Lantern Hours', { exact: true }).first().waitFor({ timeout: 20_000 })
    await pause(400)

    await shot(page, 'library.png')

    const search = page.getByRole('searchbox', { name: 'Search episodes' })
    await search.fill('orchard')
    await page.getByText('Glass Orchard', { exact: true }).first().waitFor()
    await pause(200)
    await shot(page, 'search.png')
    await search.fill('')
    await page.getByText('Wire Shed', { exact: true }).first().waitFor()

    await page.getByRole('button', { name: 'Play Glass Orchard' }).click()
    await page.locator('.player-title', { hasText: 'Glass Orchard' }).waitFor()
    const playerError = page.locator('.player-error')
    if (await playerError.count()) {
      throw new Error(`Player failed: ${await playerError.innerText()}`)
    }
    await page.getByRole('button', { name: 'Chapters' }).click()
    await page.getByText('What the lantern shows').waitFor()
    await pause(200)
    await shot(page, 'player.png')
    await page.getByRole('button', { name: 'Chapters' }).click()
    await page.getByText('What the lantern shows').waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'Listening Stats' }).click()
    await page.getByRole('heading', { name: 'Listening stats' }).waitFor()
    await pause(300)
    await shot(page, 'stats.png')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Toggle theme' }).click()
    await page.locator('html[data-theme="light"]').waitFor()
    await pause(300)
    await shot(page, 'library-light.png')
  } finally {
    await app?.close().catch(() => undefined)
    rmSync(userData, { recursive: true, force: true })
  }
}

async function shot(page: Page, name: string): Promise<void> {
  const file = join(outDir, name)
  await page.screenshot({ path: file })
  const size = statSync(file).size
  if (size < 10_000) throw new Error(`${name} is only ${size} bytes`)
  console.log(`${name} (${size} bytes)`)
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureDisplay(): void {
  if (process.platform !== 'linux' || process.env.DISPLAY) return
  if (process.env.JTUNES_SCREENSHOTS_XVFB === '1') {
    throw new Error('xvfb-run did not provide a DISPLAY')
  }
  const result = spawnSync(
    'xvfb-run',
    ['-a', '-s', '-screen 0 1400x900x24', process.execPath, ...process.execArgv, ...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, JTUNES_SCREENSHOTS_XVFB: '1' } }
  )
  if (result.error) {
    throw new Error(`xvfb-run is required for headless screenshots: ${result.error.message}`)
  }
  process.exit(result.status ?? 1)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
