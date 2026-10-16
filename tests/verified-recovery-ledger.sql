-- Payment evidence ledger acceptance checks; no writes.
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.verified_recovery_payments','INSERT') OR has_table_privilege('authenticated','public.verified_recovery_payments','UPDATE') OR has_table_privilege('authenticated','public.verified_recovery_payments','DELETE') THEN RAISE EXCEPTION 'Payment evidence must be server-only writable'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.verified_recovery_payments'::regclass) THEN RAISE EXCEPTION 'Missing payment evidence RLS'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.verified_recovery_payments'::regclass AND contype='u') THEN RAISE EXCEPTION 'Missing payment deduplication'; END IF;
END $$;
