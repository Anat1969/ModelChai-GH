/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react(), version()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
