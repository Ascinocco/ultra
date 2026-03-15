# Ultra Implementation Plan

## Status

Draft v0.1

This document is the entry point for the Ultra implementation plan.

The implementation plan is intentionally split into milestone documents so that each phase can later receive:

- a deeper architecture spec
- a sprint plan

This keeps planning modular and makes it easier to iterate without rewriting one giant roadmap document.

## Milestone Structure

1. [01-foundations.md](/Users/tony/Projects/ultra/docs/implementation-plan/01-foundations.md)
   Architecture: [01-foundations-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/01-foundations-architecture.md)
   Sprint plan: [01-foundations-sprint-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/01-foundations-sprint-plan.md)
2. [02-chat-and-thread-core.md](/Users/tony/Projects/ultra/docs/implementation-plan/02-chat-and-thread-core.md)
   Architecture: [02-chat-and-thread-core-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/02-chat-and-thread-core-architecture.md)
   Sprint plan: [02-chat-and-thread-core-sprint-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/02-chat-and-thread-core-sprint-plan.md)
3. [03-editor-review-loop.md](/Users/tony/Projects/ultra/docs/implementation-plan/03-editor-review-loop.md)
   Architecture: [03-editor-review-loop-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/03-editor-review-loop-architecture.md)
   Sprint plan: [03-editor-review-loop-sprint-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/03-editor-review-loop-sprint-plan.md)
4. [04-runtime-supervision.md](/Users/tony/Projects/ultra/docs/implementation-plan/04-runtime-supervision.md)
   Architecture: [04-runtime-supervision-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/04-runtime-supervision-architecture.md)
   Sprint plan: [04-runtime-supervision-sprint-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/04-runtime-supervision-sprint-plan.md)
5. [05-browser-and-artifact-sharing.md](/Users/tony/Projects/ultra/docs/implementation-plan/05-browser-and-artifact-sharing.md)
   Architecture: [05-browser-and-artifact-sharing-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/05-browser-and-artifact-sharing-architecture.md)
   Sprint plan: [05-browser-and-artifact-sharing-sprint-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/05-browser-and-artifact-sharing-sprint-plan.md)
6. [06-publish-and-hardening.md](/Users/tony/Projects/ultra/docs/implementation-plan/06-publish-and-hardening.md)
   Architecture: [06-publish-and-hardening-architecture.md](/Users/tony/Projects/ultra/docs/implementation-plan/06-publish-and-hardening-architecture.md)
   Sprint plan: [06-publish-and-hardening-sprint-plan.md](/Users/tony/Projects/ultra/docs/implementation-plan/06-publish-and-hardening-sprint-plan.md)

Cross-cutting input feature:

- [voice-input.md](/Users/tony/Projects/ultra/docs/voice-input.md)

## Why This Structure

Ultra now has enough product definition that implementation planning should move from broad feature ideation to staged execution.

These milestones are ordered to maximize learning and minimize rework:

1. establish shell, backend, IPC, persistence, and state model
2. prove chat and thread creation
3. prove review and editing loop
4. harden runtime supervision
5. add browser and artifact sharing
6. finish publish flow and operational hardening

## Deliverable Pattern

Each milestone document should eventually have two companion documents:

- architecture spec
- sprint plan

That means each milestone becomes a 3-document planning unit:

- implementation milestone
- milestone architecture
- milestone sprint plan

## Guidance For Future Passes

- keep milestone docs product-facing and outcome-oriented
- keep architecture docs system-facing and boundary-oriented
- keep sprint plans execution-facing and concrete

Do not collapse these into one document unless the scope is tiny.
