import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "../../..")
const vendorRoot = resolve(repoRoot, "vendor/code-oss")
const serverEntry = resolve(vendorRoot, "out/server-main.js")

if (!existsSync(vendorRoot)) {
  console.error(
    "Code-OSS vendor workspace is missing. Run `git submodule update --init --recursive`.",
  )
  process.exit(1)
}

if (!existsSync(serverEntry)) {
  console.error(
    "Code-OSS host is not prepared. Run `pnpm --filter @ultra/desktop editor-host:prepare`.",
  )
  process.exit(1)
}

console.log(`Code-OSS host is ready at ${serverEntry}`)
