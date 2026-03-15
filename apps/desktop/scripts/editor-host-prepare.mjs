import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "../../..")
const vendorRoot = resolve(repoRoot, "vendor/code-oss")

if (!existsSync(vendorRoot)) {
  console.error(
    "Code-OSS vendor workspace is missing. Run `git submodule update --init --recursive` first.",
  )
  process.exit(1)
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: vendorRoot,
    stdio: "inherit",
    env: process.env,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(resolve(vendorRoot, "node_modules"))) {
  run(npmCommand, ["install"])
}

run(npmCommand, ["run", "server:init"])
