-- Add a database-side throttle to the intentionally public lead form. This is a
-- defense-in-depth limit by normalized email and phone; edge/IP-level throttling
-- should still be added if public traffic grows.
CREATE INDEX IF NOT EXISTS public_leads_email_created_at_idx
  ON public.public_leads (lower(btrim(email)), created_at DESC);
CREATE INDEX IF NOT EXISTS public_leads_phone_created_at_idx
  ON public.public_leads ((regexp_replace(phone, '[^0-9]', '', 'g')), created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_public_lead_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  normalized_phone text;
  recent_email_count integer;
  recent_phone_count integer;
BEGIN
  normalized_phone := regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g');

  -- Serialize concurrent submissions for the same identity before counting.
  PERFORM pg_advisory_xact_lock(hashtextextended('public_lead_email:' || lower(btrim(NEW.email)), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('public_lead_phone:' || normalized_phone, 0));

  SELECT count(*) INTO recent_email_count
  FROM public.public_leads
  WHERE lower(btrim(email)) = lower(btrim(NEW.email))
    AND created_at >= now() - interval '1 hour';

  IF recent_email_count >= 5 THEN
    RAISE EXCEPTION 'Too many lead submissions for this email. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO recent_phone_count
  FROM public.public_leads
  WHERE regexp_replace(phone, '[^0-9]', '', 'g') = normalized_phone
    AND created_at >= now() - interval '1 hour';

  IF recent_phone_count >= 5 THEN
    RAISE EXCEPTION 'Too many lead submissions for this phone. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_public_lead_rate_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_public_lead_rate_limit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_public_lead_rate_limit() FROM authenticated;

DROP TRIGGER IF EXISTS enforce_public_lead_rate_limit ON public.public_leads;
CREATE TRIGGER enforce_public_lead_rate_limit
  BEFORE INSERT ON public.public_leads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_public_lead_rate_limit();
