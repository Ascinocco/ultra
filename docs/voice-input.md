# Ultra Voice Input

## Status

Draft v0.1

This document defines speech-to-text input for Ultra chat surfaces.

Related specs:

- [product-spec.md](/Users/tony/Projects/ultra/docs/product-spec.md)
- [chat-contract.md](/Users/tony/Projects/ultra/docs/chat-contract.md)
- [thread-contract.md](/Users/tony/Projects/ultra/docs/thread-contract.md)
- [backend-ipc.md](/Users/tony/Projects/ultra/docs/backend-ipc.md)

## Purpose

Ultra should support speech-to-text input in chat text boxes so the user can talk directly to the product instead of typing everything manually.

This is an input convenience feature, not a separate conversational mode.

## Core UX

The user should be able to:

- press a button in the chat input
- or use a hotkey
- speak
- stop recording
- see the transcribed text inserted into the current draft input
- edit the draft before sending

Ultra should not auto-send by default.

## Scope

Voice input should be implemented as a reusable component so it can support:

- main chat input
- thread coordinator chat input

The first implementation may land in the main chat input first, but the design should not hard-code it there.

## Technical Direction

Ultra should use local speech-to-text via `whisper.cpp`.

### Why

- no per-use third-party cost
- no dependency on a cloud STT vendor
- works independently of Claude or Codex subscriptions
- keeps control inside the Ultra product/runtime

## Product Rules

- voice input is local
- captured audio is transcribed by Ultra-owned local runtime
- transcript is inserted into the active draft
- user confirms final send manually
- no wake words
- no always-on listening
- no voice-command mode in v1

## Interaction Model

### Start Methods

- click microphone button in chat input
- press a configurable hotkey

### Stop Methods

- click stop
- press the same hotkey again
- automatic stop on explicit user action only in v1

### Output Behavior

- insert transcript into current draft buffer
- preserve existing draft text
- append or replace according to the active insertion policy

Recommended v1 policy:

- append transcribed text at cursor position or end of draft

## Reusable Component Contract

Voice input should be implemented as a reusable input primitive.

Recommended frontend units:

- `VoiceInputButton`
- `VoiceInputStatus`
- `useVoiceInput`

### Reuse Rule

Main chat and thread chat should use the same voice-input behavior and backend contract.

Only the destination draft buffer changes.

## Backend Contract

Voice input should be handled by a dedicated backend service.

Recommended service:

- `VoiceInputService`

Responsibilities:

- accept audio capture payloads or session streams
- invoke local `whisper.cpp`
- return transcription results
- expose failure states cleanly

## IPC Direction

Ultra should add a `voice.*` namespace or equivalent operation group.

Recommended operations:

- `voice.start_capture`
- `voice.stop_capture`
- `voice.cancel_capture`
- `voice.transcription_ready`
- `voice.transcription_failed`

### Product Rule

Voice input should remain separate from chat runtime/model invocation.

Speech-to-text produces draft text. It does not directly invoke the LLM.

## Audio Capture Model

Use explicit microphone capture initiated by the user.

### Rules

- request microphone permission when needed
- show clear recording state
- never record continuously in the background
- stop capture when the user cancels or stops

## UI States

Recommended states:

- `idle`
- `recording`
- `transcribing`
- `ready`
- `failed`

### UI Requirements

- recording state must be visually obvious
- transcribing state must be visible
- failure state must be actionable

## Hotkey Model

Voice input should support a configurable hotkey.

Recommended v1 behavior:

- one global-in-app shortcut for voice input
- operates on the currently focused chat input if one exists
- if no supported input is focused, do nothing

This avoids accidental capture in the wrong context.

## Draft Insertion Rules

When transcription completes:

- insert into the currently active draft input
- do not auto-submit
- preserve the user's ability to edit before send

### Collision Rule

If the draft changed while recording/transcribing:

- insert the transcription into the latest draft state
- do not discard the user's typed changes

## Error Handling

Voice input should visibly handle:

- microphone permission denied
- microphone unavailable
- recording interrupted
- transcription failure
- no active draft target

## Privacy Rules

- audio stays local to Ultra's local runtime path
- voice input does not depend on vendor-hosted STT
- recorded audio is transient and deleted after transcription completes or the capture is canceled

## Data Model Direction

Voice input does not introduce dedicated persistent tables in v1.

Transcription state is transient until the user sends the resulting draft as a normal chat or thread message.

## Implementation Priority

This feature is a reusable input enhancement implemented as part of the chat/thread input system.

## Locked Decisions

1. Voice input uses local `whisper.cpp`
2. Voice input inserts text into draft inputs rather than auto-sending
3. The feature is reusable across main chat and thread chat
4. Voice input is local-only and user-initiated
5. No voice-command mode in v1
6. The renderer records microphone audio into a temporary local file and hands the file path to the backend STT service for transcription
7. Partial transcription streaming is out of scope for v1; transcription happens after the user stops recording
8. The default hotkey is `Cmd/Ctrl+Shift+I`, and the user may override it in settings
