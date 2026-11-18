import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const rootDir = dirname(fileURLToPath(import.meta.url))
const r = (p: string) => resolve(rootDir, p)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: r('src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': r('src/shared'),
        '@main': r('src/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: r('src/preload/index.ts')
        },
        // The renderer runs with `sandbox: true`, and Electron does not
        // support ESM preload scripts in a sandboxed renderer. The preload
        // is therefore emitted as CommonJS with a .cjs extension.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    },
    resolve: {
      alias: {
        '@shared': r('src/shared')
      }
    }
  },
  renderer: {
    root: r('src/renderer'),
    resolve: {
      alias: {
        '@shared': r('src/shared'),
        '@renderer': r('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: r('src/renderer/index.html')
        }
      }
    },
    plugins: [react()]
  }
})
