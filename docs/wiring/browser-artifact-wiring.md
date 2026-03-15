# Ultra Browser and Artifact Wiring

## Scope

This document covers:

- Browser page
- side browser
- bookmarks
- manual vs automation browser separation
- artifact capture
- artifact sharing into chats and threads

## Flow: Open Browser Page

User action:

- click the `Browser` top pill

IPC:

- `browser.get_state`
- `browser.list_bookmarks`

Backend:

- load manual browser state
- load global bookmarks

DB:

- `browser_profiles`
- `browser_bookmarks`

Store updates:

- hydrate browser page state

## Flow: Open Side Browser

User action:

- click `Open Side Browser` from Chat or Editor

IPC:

- `browser.set_side_open`
- optionally `browser.set_side_destination`

Backend:

- persist side browser state if tracked server-side

Store updates:

- mark side browser open
- set source page
- set default destination context

## Flow: Navigate Browser

User action:

- enter URL or use browser controls

IPC:

- `browser.navigate`

Backend:

- update browser state projection if needed

Store updates:

- update current URL and nav state

## Flow: Bookmark Page

User action:

- add bookmark from browser toolbar

IPC:

- `browser.create_bookmark`
- `browser.list_bookmarks`

Backend:

- persist bookmark in global manual browser profile scope

DB:

- `browser_bookmarks`

Store updates:

- refresh bookmark list

## Flow: Capture Browser Artifact

User action:

- click a browser share action

IPC:

- `artifacts.capture_browser`

Backend:

- capture selected browser context
- normalize into artifact bundle
- persist artifact metadata

DB:

- `artifacts`
- optional browser session records

Store updates:

- stage artifact for destination selection or immediate send

## Flow: Capture Runtime Artifact

User action:

- click an editor/runtime share action

IPC:

- `artifacts.capture_runtime`

Backend:

- collect managed terminal/debug/test output
- normalize into artifact bundle
- persist artifact metadata

DB:

- `artifacts`

Store updates:

- stage artifact for destination selection or immediate send

## Flow: Share To Chat

User action:

- confirm destination chat

IPC:

- `artifacts.share_to_chat`

Backend:

- create artifact share record
- attach structured artifact reference into chat context

DB:

- `artifact_shares`
- `artifacts`
- `chat_messages`

Store updates:

- append structured artifact attachment message to the destination chat

## Flow: Share To Thread

User action:

- confirm destination thread

IPC:

- `artifacts.share_to_thread`

Backend:

- create artifact share record
- attach artifact reference into thread/coordinator context

DB:

- `artifact_shares`
- `artifacts`
- thread message/event storage as implemented

Store updates:

- append visible artifact attachment in the destination thread UI

## Flow: Share All Context

User action:

- click `Share All Context`

IPC:

- `artifacts.share_all_context`

Backend:

- capture browser context
- capture runtime context
- build combined bundle
- route to selected destination

DB:

- `artifacts`
- `artifact_shares`
- destination transcript/event store

Store updates:

- append combined artifact attachment to destination

## Flow: Automation Browser QA

Trigger:

- thread requests browser QA

Backend:

- launch isolated automation browser session
- collect QA artifacts
- attach resulting artifacts to thread

DB:

- `browser_sessions`
- `artifacts`

Important rule:

- no manual browser profile or manual browser cookies are used
