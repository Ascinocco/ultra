# Milestone 6: Publish and Hardening

## Goal

Finish the end-to-end loop with branch publish flow, draft PR creation, artifact/log retention policy, failure handling cleanup, and overall product hardening.

## Why Sixth

This milestone should come last because publish and hardening depend on the earlier milestones being real first.

## Scope

- post-approval publish flow
- branch push behavior
- draft PR creation
- branch/commit/PR templates
- publish status updates
- failure and retry handling for publish
- log retention and compaction
- performance cleanup
- UX refinement for edge states

## Deliverables

- approved threads can publish to a new branch
- draft PR creation works with thread metadata
- publish state appears in thread state and timeline
- publish failures are actionable
- raw logs have a retention strategy
- large timelines and chats remain usable

## Out of Scope

- multi-user collaboration
- cloud sync
- highly advanced release automation beyond draft PRs

## Technical Decisions To Respect

- thread completion happens after user approval
- publish is a separate lifecycle
- structured events are durable, raw logs are compactable

## Exit Criteria

- user can approve a thread and have Ultra carry it through publish flow
- publish errors are understandable and retryable
- data growth is manageable
- the product feels stable enough for daily use

## Main Risks

- Git/PR edge cases
- poor failure messaging at the last step of the workflow
- unbounded local data growth
