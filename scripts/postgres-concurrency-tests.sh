#!/usr/bin/env bash
set -euo pipefail
# Isolated CI database only; credentials belong to the ephemeral PostgreSQL service.
owner_log=$(mktemp)
trap 'rm -f "$owner_log"' EXIT
PGAPPNAME=qa-lease-owner psql -X -v ON_ERROR_STOP=1 -c "BEGIN;
SELECT public.claim_stripe_webhook_event('evt_concurrency','customer.subscription.updated',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',60);
SELECT pg_sleep(2); COMMIT;" > "$owner_log" 2>&1 &
owner_pid=$!
ready=0
for attempt in {1..40}; do
  if [[ $(psql -X -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name='qa-lease-owner' AND wait_event='PgSleep'") == 1 ]]; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ $ready != 1 ]]; then
  wait "$owner_pid" || cat "$owner_log"
  exit 1
fi
contender=$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT public.claim_stripe_webhook_event('evt_concurrency','customer.subscription.updated',false,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',60)")
wait "$owner_pid"
[[ $contender == busy ]] || { printf 'Unexpected contender result: %s\n' "$contender"; exit 1; }
psql -X -v ON_ERROR_STOP=1 <<'SQL'
UPDATE public.stripe_webhook_events SET processing_lease_until=clock_timestamp()-interval '1 second' WHERE event_id='evt_concurrency';
DO $$ BEGIN
 IF public.claim_stripe_webhook_event('evt_concurrency','customer.subscription.updated',false,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',60) <> 'claimed' THEN RAISE EXCEPTION 'Expired lease not reclaimable'; END IF;
 IF public.finish_stripe_webhook_event('evt_concurrency','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null) THEN RAISE EXCEPTION 'Stale worker completed reclaimed lease'; END IF;
 IF NOT public.finish_stripe_webhook_event('evt_concurrency','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null) THEN RAISE EXCEPTION 'Current worker could not finish'; END IF;
END $$;
SQL
printf 'Concurrent lease contention, expiry and stale-worker fencing passed.\n'
