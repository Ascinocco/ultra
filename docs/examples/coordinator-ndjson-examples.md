# Coordinator NDJSON Examples

These examples are illustrative v1 wire payloads for the coordinator transport defined in [coordinator-runtime.md](/Users/tony/Projects/ultra/docs/coordinator-runtime.md).

Each line is one UTF-8 JSON message.

## Hello Handshake

```json
{"kind":"command","protocol_version":"1.0","request_id":"coord_req_hello_1","command":"hello","project_id":"project_123","coordinator_id":"coord_project_123","payload":{"backend_instance_id":"backend_instance_1","supported_protocol_versions":["1.0"]}}
{"kind":"response","protocol_version":"1.0","request_id":"coord_req_hello_1","ok":true,"result":{"accepted_protocol_version":"1.0","coordinator_id":"coord_project_123","coordinator_instance_id":"coord_instance_1","coordinator_version":"0.1.0","capabilities":{"supports_thread_retry":true,"supports_project_pause":true,"supports_project_resume":true,"supports_thread_messages":true}}}
```

## Start Thread Happy Path

```json
{"kind":"command","protocol_version":"1.0","request_id":"coord_req_start_thread_1","command":"start_thread","project_id":"project_123","thread_id":"thread_123","coordinator_id":"coord_project_123","payload":{"thread_title":"Implement review flow","execution_summary":"Build the first review-ready thread path for this project.","spec_markdown":"# Thread spec\nImplement the review flow and make it publish-ready.","ticket_refs":[{"provider":"linear","ticket_id":"ULR-31"}],"chat_refs":[{"chat_id":"chat_123","message_ids":["chat_msg_1","chat_msg_2"]}],"checkout_context":{"target_id":"target_123","worktree_path":"/tmp/ultra/project/worktrees/thread_123","branch_name":"thread/ulr-31","base_branch":"main"},"attachments":[]}}
{"kind":"response","protocol_version":"1.0","request_id":"coord_req_start_thread_1","ok":true,"result":{"accepted":true,"queued":true,"message":"Thread accepted for execution."}}
{"kind":"event","protocol_version":"1.0","event_id":"coord_evt_1","sequence_number":1,"event_type":"thread_execution_state_changed","project_id":"project_123","coordinator_id":"coord_project_123","coordinator_instance_id":"coord_instance_1","thread_id":"thread_123","occurred_at":"2026-03-15T20:00:00.000Z","payload":{"from_state":"queued","to_state":"running","reason":"Thread execution started."}}
```

## Send Thread Message

```json
{"kind":"command","protocol_version":"1.0","request_id":"coord_req_msg_1","command":"send_thread_message","project_id":"project_123","thread_id":"thread_123","coordinator_id":"coord_project_123","payload":{"message_id":"thread_msg_user_1","role":"user","content_markdown":"Please rerun tests before opening review.","attachments":[]}}
{"kind":"response","protocol_version":"1.0","request_id":"coord_req_msg_1","ok":true,"result":{"accepted":true,"message":"Thread message accepted."}}
{"kind":"event","protocol_version":"1.0","event_id":"coord_evt_2","sequence_number":2,"event_type":"thread_message_emitted","project_id":"project_123","coordinator_id":"coord_project_123","coordinator_instance_id":"coord_instance_1","thread_id":"thread_123","occurred_at":"2026-03-15T20:01:00.000Z","payload":{"message_id":"thread_msg_assistant_1","role":"assistant","message_type":"assistant_text","content_markdown":"Tests are rerunning now.","attachments":[]}}
```

## Heartbeat

```json
{"kind":"event","protocol_version":"1.0","event_id":"coord_evt_3","sequence_number":3,"event_type":"heartbeat","project_id":"project_123","coordinator_id":"coord_project_123","coordinator_instance_id":"coord_instance_1","occurred_at":"2026-03-15T20:02:00.000Z","payload":{"status":"healthy","last_heartbeat_at":"2026-03-15T20:02:00.000Z","active_thread_ids":["thread_123"],"active_agent_count":2}}
```

## Review Ready

```json
{"kind":"event","protocol_version":"1.0","event_id":"coord_evt_4","sequence_number":4,"event_type":"thread_review_ready","project_id":"project_123","coordinator_id":"coord_project_123","coordinator_instance_id":"coord_instance_1","thread_id":"thread_123","occurred_at":"2026-03-15T20:06:00.000Z","payload":{"worktree_path":"/tmp/ultra/project/worktrees/thread_123","branch_name":"thread/ulr-31","base_branch":"main","commit_id":"abc1234","changed_file_count":7}}
```

## Coordinator Restart

```json
{"kind":"event","protocol_version":"1.0","event_id":"coord_evt_1","sequence_number":1,"event_type":"runtime_status_changed","project_id":"project_123","coordinator_id":"coord_project_123","coordinator_instance_id":"coord_instance_2","occurred_at":"2026-03-15T20:10:00.000Z","payload":{"from_status":"down","to_status":"healthy","reason":"Coordinator restarted after supervisor recovery.","restart_count":1}}
{"kind":"event","protocol_version":"1.0","event_id":"coord_evt_2","sequence_number":2,"event_type":"thread_execution_state_changed","project_id":"project_123","coordinator_id":"coord_project_123","coordinator_instance_id":"coord_instance_2","thread_id":"thread_123","occurred_at":"2026-03-15T20:10:02.000Z","payload":{"from_state":"paused","to_state":"running","reason":"Thread rebound to restarted coordinator instance."}}
```

## Thread-Scoped Runtime Error

```json
{"kind":"event","protocol_version":"1.0","event_id":"coord_evt_5","sequence_number":5,"event_type":"error","project_id":"project_123","coordinator_id":"coord_project_123","coordinator_instance_id":"coord_instance_1","thread_id":"thread_123","occurred_at":"2026-03-15T20:07:00.000Z","payload":{"scope":"thread","code":"runtime_unavailable","message":"Worker execution stalled while tests were running.","details":{"agent_id":"agent_7","last_known_step":"npm test"},"retryable":true}}
```
