# Revenue Recovery delivery preflight — dry-run only

Supabase function: `recovery-delivery-preflight` (deployed version 1; JWT required).

POST `/functions/v1/recovery-delivery-preflight` with an authenticated Supabase user JWT:

```json
{"workspace_id":"<uuid>","approval_id":"<uuid>"}
```

The endpoint verifies:
- The access token resolves to a real signed-in user.
- The user is an owner or admin of the requested workspace.
- The approval is a recorded `recovery_draft_approved` audit event in that workspace.
- The approval references an opportunity and customer in the same workspace.
- The newest customer consent event for the selected communication channel is granted, references the same consent event ID, and matches the approval's evidence reference.
- The approval is marked `not_sent`.

Successful response: `{"authorized":true,"delivery_enabled":false,"status":"dry_run_only", ...}`.

**No SMS, email, or calls are transmitted.** The function intentionally has no provider integration, message queue, or send operation. Repeated calls remain dry-run only.

Do not interpret preflight success as authorization to send asynchronously later: recheck consent atomically at actual send time, implement outbound idempotency and provider receipts, process inbound opt-outs, and validate actual delivery with test workspaces. This function is not a finished delivery service.

Current read-only database evidence: no `recovery_draft_approved` rows existed at implementation, so authenticated end-to-end positive-path testing was not possible without creating test records.
