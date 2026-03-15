# Ultra Wiring Overview

## Status

Draft v0.1

This directory defines the end-to-end wiring instructions that connect product interactions to implementation layers.

These documents exist to answer the question:

`When the user does X, what exact frontend, IPC, backend, persistence, and subscription flow should happen?`

## Wiring Docs

- [app-wiring.md](/Users/tony/Projects/ultra/docs/wiring/app-wiring.md)
- [chat-thread-wiring.md](/Users/tony/Projects/ultra/docs/wiring/chat-thread-wiring.md)
- [editor-review-wiring.md](/Users/tony/Projects/ultra/docs/wiring/editor-review-wiring.md)
- [runtime-wiring.md](/Users/tony/Projects/ultra/docs/wiring/runtime-wiring.md)
- [browser-artifact-wiring.md](/Users/tony/Projects/ultra/docs/wiring/browser-artifact-wiring.md)
- [voice-input-wiring.md](/Users/tony/Projects/ultra/docs/wiring/voice-input-wiring.md)

## Wiring Format

Each wiring doc should describe, for each major flow:

- user action
- initiating UI surface
- frontend store updates
- IPC commands/queries/subscriptions
- backend services invoked
- DB tables read/written
- events emitted
- downstream UI updates

## Why This Exists

The product, architecture, IPC, and schema docs define the system well.

The wiring docs ensure those layers actually line up during implementation.
