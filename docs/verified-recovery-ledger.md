# Verified revenue attribution — evidence ledger foundation

Production schema: `public.verified_recovery_payments` (migration `create_verified_recovery_payment_attribution_ledger`).

Only trusted server-side reconciliation code may insert a record, after checking the actual paid/settled transaction with the payment provider. Ordinary authenticated clients may read only their own workspace's ledger rows; they cannot write or edit financial evidence. Each row binds a workspace, customer, and opportunity and requires a provider, external payment ID, positive amount in integer cents, collection date and verification date. The unique `(workspace_id,payment_provider,external_payment_id)` constraint prevents the same payment from being credited twice within a workspace. A database trigger rejects relationships across mismatched workspaces or customers.

**Important:** The existing opportunity-level `recovered_amount` and `recovery_events` entries are *not independently verified collections*. Neither should be presented as verified recovered revenue. This new ledger currently has no reconciliation webhook or importer, so it must report **zero verified payments** until an authenticated provider integration supplies evidence. Do not insert placeholder evidence. A future processor must also handle refunds, disputes, chargebacks and allocation across opportunities, and enforce source-account ownership.

The ledger schema is not proof of provider connection, paid customer testing, or fully completed attribution. Run `tests/verified-recovery-ledger.sql` for security and deduplication structure.
