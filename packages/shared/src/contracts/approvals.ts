import { z } from "zod"
import { isoUtcTimestampSchema, opaqueIdSchema } from "./constants.js"
import { projectIdSchema } from "./projects.js"
import { threadIdSchema } from "./threads.js"

export const approvalTypeSchema = z.enum([
  "plan",
  "spec",
  "review",
  "publish",
])

export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
])

export const approvalSnapshotSchema = z.object({
  approvalId: z.string(),
  projectId: projectIdSchema,
  threadId: threadIdSchema,
  approvalType: approvalTypeSchema,
  status: approvalStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  requestedAt: isoUtcTimestampSchema,
  resolvedAt: isoUtcTimestampSchema.nullable(),
  resolvedBy: z.string().nullable(),
})

export type ApprovalType = z.infer<typeof approvalTypeSchema>
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>
export type ApprovalSnapshot = z.infer<typeof approvalSnapshotSchema>

export function parseApprovalSnapshot(input: unknown): ApprovalSnapshot {
  return approvalSnapshotSchema.parse(input)
}
