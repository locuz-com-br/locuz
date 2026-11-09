-- Invariant tests for db/migrations/0001_agenda.sql. Run in a throwaway PG16:
--   bash db/tests/run-pg16.sh
-- Each block raises on the first broken rule.

-- @test the switch is off by default and refuses every booking
DO $$
DECLARE v jsonb;
BEGIN
  ASSERT agenda.setting('ativa') = 'false'::jsonb;
  v := agenda.book('publico', date_trunc('hour', now()) + interval '1 day 3 hours', 'system:test',
    '5521987650100', 'Ana', NULL, 'ip-off');
  ASSERT v->>'reason' = 'desligado', v::text;
  ASSERT (SELECT resultado FROM agenda.booking_requests WHERE id = (v->>'request_id')::bigint) = 'desligado';
  UPDATE agenda.settings SET value = 'true' WHERE key = 'ativa';
END $$;

-- @test a public booking takes 15 min on the locuz calendar and blocks the same phone
DO $$
DECLARE v jsonb; t timestamptz := date_trunc('hour', now()) + interval '1 day 3 hours';
BEGIN
  v := agenda.book('publico', t, 'system:test', '+55 (21) 98765-0101', 'Bia', NULL, 'ip-a', '{"projeto":"site"}', 'ref-1');
  ASSERT v->>'ok' = 'true', v::text;
  ASSERT (SELECT ends_at - starts_at = interval '15 minutes' AND calendar_id = 'contato@locuz.com.br' AND ref = 'ref-1'
            FROM agenda.meetings WHERE id = (v->>'meeting_id')::bigint);
  -- ninth-digit variant of the same phone, another slot, another IP
  v := agenda.book('publico', t + interval '2 hours', 'system:test', '552187650101', 'Bia', NULL, 'ip-b');
  ASSERT v->>'reason' = 'ja_agendado', v::text;
END $$;

-- @test two people cannot hold overlapping slots; a cancel frees it
DO $$
DECLARE v1 jsonb; v2 jsonb; t timestamptz := date_trunc('hour', now()) + interval '2 days 3 hours';
BEGIN
  v1 := agenda.book('publico', t, 'system:test', '5521987650102', NULL, NULL, 'ip-c');
  ASSERT v1->>'ok' = 'true', v1::text;
  v2 := agenda.book('publico', t + interval '10 minutes', 'system:test', '5521987650103', NULL, NULL, 'ip-d');
  ASSERT v2->>'reason' = 'slot_taken', v2::text;
  ASSERT agenda.cancel_meeting((v1->>'meeting_id')::bigint, 'system:test');
  v2 := agenda.book('publico', t + interval '10 minutes', 'system:test', '5521987650103', NULL, NULL, 'ip-d');
  ASSERT v2->>'ok' = 'true', v2::text;
  ASSERT (SELECT count(*) FROM agenda.busy(t, t + interval '1 hour')) = 1;
END $$;

-- @test the same IP cannot hold two upcoming public bookings, and a missing IP is refused
DO $$
DECLARE v jsonb; t timestamptz := date_trunc('hour', now()) + interval '3 days 3 hours';
BEGIN
  v := agenda.book('publico', t, 'system:test', '5521987650104', NULL, NULL, 'ip-e');
  ASSERT v->>'ok' = 'true', v::text;
  v := agenda.book('publico', t + interval '1 hour', 'system:test', '5521987650105', NULL, NULL, 'ip-e');
  ASSERT v->>'reason' = 'ja_agendado_ip', v::text;
  v := agenda.book('publico', t + interval '1 hour', 'system:test', '5521987650105', NULL, NULL, NULL);
  ASSERT v->>'reason' = 'ip_ausente', v::text;
END $$;

-- @test per-IP attempts hit the hourly limit
DO $$
DECLARE v jsonb; i int; t timestamptz := date_trunc('hour', now()) + interval '4 days 3 hours';
BEGIN
  FOR i IN 1..5 LOOP
    PERFORM agenda.book('publico', t, 'system:test', 'bad', NULL, NULL, 'ip-f');
  END LOOP;
  v := agenda.book('publico', t, 'system:test', '5521987650106', NULL, NULL, 'ip-f');
  ASSERT v->>'reason' = 'limite', v::text;
END $$;

-- @test times outside notice and horizon are refused
DO $$
DECLARE v jsonb;
BEGIN
  v := agenda.book('publico', now() + interval '30 minutes', 'system:test', '5521987650107', NULL, NULL, 'ip-g');
  ASSERT v->>'reason' = 'invalido', v::text;
  v := agenda.book('publico', now() + interval '20 days', 'system:test', '5521987650107', NULL, NULL, 'ip-g');
  ASSERT v->>'reason' = 'invalido', v::text;
END $$;

-- @test a private link books once, binds its phone, and its token is not stored
DO $$
DECLARE l jsonb; v jsonb; t timestamptz := date_trunc('hour', now()) + interval '5 days 3 hours';
BEGIN
  l := agenda.create_booking_link('5521987650108', 'teste', 'system:test', 'Caio');
  ASSERT l->>'ok' = 'true', l::text;
  ASSERT NOT EXISTS (SELECT 1 FROM agenda.booking_links WHERE token_sha256 = l->>'token');
  ASSERT agenda.resolve_booking_link(l->>'token')->>'phone' = '5521987650108';
  v := agenda.book('link', t, 'system:test', '5521987650199', NULL, l->>'token');
  ASSERT v->>'reason' = 'link_invalido', 'link used by another phone: ' || v::text;
  v := agenda.book('link', t, 'system:test', NULL, NULL, l->>'token');
  ASSERT v->>'ok' = 'true', v::text;
  ASSERT (SELECT lead_name = 'Caio' AND phone = '5521987650108' FROM agenda.meetings WHERE id = (v->>'meeting_id')::bigint);
  ASSERT agenda.resolve_booking_link(l->>'token')->>'reason' = 'link_usado';
  v := agenda.book('link', t + interval '1 hour', 'system:test', NULL, NULL, l->>'token');
  ASSERT v->>'reason' = 'link_invalido', v::text;
  ASSERT agenda.book('publico', t, 'system:test', '5521987650109', NULL, l->>'token', 'ip-h')->>'reason' = 'invalido';
END $$;

-- @test an expired or revoked link is refused
DO $$
DECLARE l jsonb;
BEGIN
  l := agenda.create_booking_link('5521987650110', 'teste', 'system:test', NULL, NULL, interval '1 second');
  UPDATE agenda.booking_links SET expires_at = now() - interval '1 minute' WHERE id = (l->>'link_id')::bigint;
  ASSERT agenda.resolve_booking_link(l->>'token')->>'reason' = 'link_vencido';
  l := agenda.create_booking_link('5521987650111', 'teste', 'system:test');
  UPDATE agenda.booking_links SET revoked_at = now() WHERE id = (l->>'link_id')::bigint;
  ASSERT agenda.resolve_booking_link(l->>'token')->>'reason' = 'link_revogado';
  ASSERT agenda.book('link', date_trunc('hour', now()) + interval '6 days 3 hours', 'system:test',
    NULL, NULL, l->>'token')->>'reason' = 'link_invalido';
  ASSERT agenda.create_booking_link('not-a-phone', 'teste', 'system:test')->>'reason' = 'invalido';
END $$;

-- @test the calendar event attaches once
DO $$
DECLARE v jsonb; t timestamptz := date_trunc('hour', now()) + interval '7 days 3 hours';
BEGIN
  v := agenda.book('publico', t, 'system:test', '5521987650112', NULL, NULL, 'ip-i');
  ASSERT agenda.attach_calendar_event((v->>'meeting_id')::bigint, 'evt-1', 'https://meet.google.com/x');
  ASSERT NOT agenda.attach_calendar_event((v->>'meeting_id')::bigint, 'evt-2', NULL);
END $$;
