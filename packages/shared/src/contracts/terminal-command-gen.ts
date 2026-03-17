import { z } from "zod"

import { opaqueIdSchema } from "./constants.js"

export const terminalCommandGenProviderSchema = z.enum(["claude", "codex"])

export const terminalCommandGenInputSchema = z.object({
  project_id: opaqueIdSchema,
  prompt: z.string().min(1),
  cwd: z.string().min(1),
  recent_output: z.string(),
  provider: terminalCommandGenProviderSchema,
  model: z.string().min(1),
  session_id: opaqueIdSchema,
})

export type TerminalCommandGenInput = z.infer<
  typeof terminalCommandGenInputSchema
>

export const terminalCommandGenDeltaEventSchema = z.object({
  type: z.literal("delta"),
  text: z.string(),
})

export const terminalCommandGenCompleteEventSchema = z.object({
  type: z.literal("complete"),
  command: z.string(),
})

export const terminalCommandGenErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
})

export const terminalCommandGenEventSchema = z.discriminatedUnion("type", [
  terminalCommandGenDeltaEventSchema,
  terminalCommandGenCompleteEventSchema,
  terminalCommandGenErrorEventSchema,
])

export type TerminalCommandGenEvent = z.infer<
  typeof terminalCommandGenEventSchema
>

export const terminalCommandGenSubscribeInputSchema =
  terminalCommandGenInputSchema

export const terminalCommandGenSubscribeRequestSchema = z.object({
  type: z.literal("subscribe"),
  name: z.literal("terminal.generate_command"),
  payload: terminalCommandGenInputSchema,
})

export function parseTerminalCommandGenInput(
  input: unknown,
): TerminalCommandGenInput {
  return terminalCommandGenInputSchema.parse(input)
}

export function parseTerminalCommandGenEvent(
  input: unknown,
): TerminalCommandGenEvent {
  return terminalCommandGenEventSchema.parse(input)
}
