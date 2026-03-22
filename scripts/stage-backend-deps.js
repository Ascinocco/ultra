// Stages backend dependencies for electron-builder packaging.
// pnpm uses symlinks which electron-builder copies as-is (broken in .app).
// This script resolves them by copying with dereferenced symlinks.
//
// NOTE: This is a build-time script run by electron-builder's beforePack hook.
// All paths are hardcoded constants (no user input), so execSync is safe here.

const { execFileSync, execSync } = require("node:child_process")
const { resolve } = require("node:path")
const { cpSync, mkdirSync, rmSync, existsSync } = require("node:fs")

const ULTRA_ROOT = resolve(__dirname, "..")
const BACKEND_ROOT = resolve(ULTRA_ROOT, "apps/backend")
const STAGE_DIR = resolve(ULTRA_ROOT, "apps/desktop/.stage/backend-deps")

exports.default = async function beforePack() {
  console.log("[stage] Cleaning staging directory...")
  rmSync(STAGE_DIR, { recursive: true, force: true })
  mkdirSync(resolve(STAGE_DIR, "dist"), { recursive: true })

  console.log("[stage] Copying backend dist...")
  cpSync(resolve(BACKEND_ROOT, "dist"), resolve(STAGE_DIR, "dist"), { recursive: true })

  console.log("[stage] Copying backend package.json...")
  cpSync(resolve(BACKEND_ROOT, "package.json"), resolve(STAGE_DIR, "package.json"))

  console.log("[stage] Copying backend node_modules (dereferencing symlinks)...")
  // Node's cpSync dereference doesn't work reliably with pnpm symlinks.
  // Use cp -RLf which properly resolves all symlink chains.
  execFileSync("cp", ["-RLf", resolve(BACKEND_ROOT, "node_modules") + "/", resolve(STAGE_DIR, "node_modules") + "/"])

  // Clean up unnecessary files to reduce bundle size
  console.log("[stage] Cleaning unnecessary files...")
  for (const dir of [".cache", ".vite", "@types"]) {
    const target = resolve(STAGE_DIR, "node_modules", dir)
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true })
    }
  }

  console.log("[stage] Backend staged successfully.")
}
