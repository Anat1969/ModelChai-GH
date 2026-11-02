/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { buildBridge } from './src/learn/bridge'

// Every build gets an id, baked into the code and written to /version.json, so an open tab can tell that a newer
// deploy is out and take it on the next move, without a manual refresh (DECISIONS.md 125).
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || String(Date.now())

const version = (): Plugin => ({
  name: 'mathcreator-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
  },
})

// bridge.json: the atlas as "מושג מתמטי" reads it, built from the atlas on every build (DECISIONS.md 143).
const bridge = (): Plugin => ({
  name: 'mathcreator-bridge',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'bridge.json', source: JSON.stringify(buildBridge(), null, 1) })
  },
})

export default defineConfig({
  plugins: [react(), version(), bridge()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  test: {
    include: ['tests/**/*.test.ts'],
    // The print and surface tests build full meshes; under the whole suite's load a few take 3–5 s each, so the
    // default 5 s limit failed them now and then. Speed is checked by their own timing assertions, not by this.
    testTimeout: 30000,
  },
})
