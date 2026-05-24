-- 20260428o_messages_ratelimit.sql
--
-- Security hardening for piktag_messages: enforces a per-sender rate limit
-- (max 30 inserts per rolling 10s window) and caps message body length at
-- 600 characters. Without this, an authenticated user can spam thousands of
-- messages per second through the INSERT policy, amplified downstream by
-- push notification fan-out.

-- Supporting index for the rate-limit count() probe.
CREATE INDEX IF NOT EXISTS idx_messages_sender_created_at
  ON public.piktag_messages (sender_id, created_at);

CREATE OR REPLACE FUNCTION public.enforce_message_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.body IS NULL OR char_length(NEW.body) > 600 THEN
    RAISE EXCEPTION 'message_body_too_long' USING ERRCODE = '22001';
  END IF;

  IF (
    SELECT count(*)
    FROM public.piktag_messages
    WHERE sender_id = NEW.sender_id
      AND created_at > now() - interval '10 seconds'
  ) >= 30 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_enforce_message_rate_limit
  BEFORE INSERT ON public.piktag_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_rate_limit();
