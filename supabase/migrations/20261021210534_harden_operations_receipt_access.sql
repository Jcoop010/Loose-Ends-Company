-- Receipts are accessible only inside validated command execution.
revoke all on table le_ops.receipts from public,anon,authenticated;
