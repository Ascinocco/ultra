# Ultra Voice Input Wiring

## Scope

This document covers:

- microphone-triggered speech capture
- local transcription
- draft insertion for chat and thread inputs

## Flow: Start Voice Input

User action:

- click mic button in an input
- or press the voice-input hotkey while a supported input is focused

IPC:

- `voice.start_capture`

Backend:

- initialize voice capture/transcription session

Store updates:

- mark focused input voice state as `recording`

UI updates:

- show recording indicator on the active input

## Flow: Stop Voice Input

User action:

- click stop
- or press the hotkey again

IPC:

- `voice.stop_capture`

Backend:

- finalize audio capture
- run local `whisper.cpp` transcription

Store updates:

- mark voice state as `transcribing`

## Flow: Transcription Ready

Trigger:

- backend finishes local transcription

IPC:

- `voice.transcription_ready`

Backend:

- return transcript text and target context

Store updates:

- mark voice state as `ready`
- insert transcript into the active draft buffer

UI updates:

- populate draft text
- keep message unsent

## Flow: Cancel Voice Input

User action:

- cancel recording or dismiss voice capture

IPC:

- `voice.cancel_capture`

Backend:

- terminate voice session

Store updates:

- reset voice state to `idle`

## Flow: Send Voice-Entered Message

User action:

- edit transcript if desired
- submit chat or thread message normally

IPC:

- `chats.send_message` or `threads.send_message`

Backend:

- persist message through normal message path

DB:

- `chat_messages` for main chat
- thread message storage as implemented for thread chat

Important rule:

- no special voice-specific message persistence is required in v1
