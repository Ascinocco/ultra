import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"

export type StoredAttachment = {
  type: "image" | "text"
  name: string
  media_type: string
  data: string // base64
}

/**
 * Resolve the attachments directory — sibling to the database file.
 * e.g. if db is at ~/.ultra/desktop/ultra.db, attachments go to ~/.ultra/desktop/attachments/
 */
function resolveAttachmentsDir(): string {
  const dbPath = process.env.ULTRA_DB_PATH?.trim()
  if (!dbPath) throw new Error("ULTRA_DB_PATH is required")
  return join(dirname(dbPath), "attachments")
}

/**
 * Persist attachments to disk for a given message ID.
 * Stores a JSON manifest with all attachment data.
 */
export function saveAttachments(
  messageId: string,
  attachments: StoredAttachment[],
): void {
  const dir = join(resolveAttachmentsDir(), messageId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(attachments), "utf-8")
}

/**
 * Load attachments from disk for a given message ID.
 * Returns empty array if no attachments found.
 */
export function loadAttachments(messageId: string): StoredAttachment[] {
  const manifest = join(resolveAttachmentsDir(), messageId, "manifest.json")
  if (!existsSync(manifest)) return []
  try {
    return JSON.parse(readFileSync(manifest, "utf-8")) as StoredAttachment[]
  } catch {
    return []
  }
}
