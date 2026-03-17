/**
 * Standalone Vite config for previewing the renderer in a browser (no Electron).
 * Used by .claude/launch.json for Claude Preview.
 */
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react()],
  server: {
    port: 5174,
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
  },
})
