-- Revert 0001_agenda: drop the agenda schema. Refuses while any meeting or
-- link exists that is not a test (dropping would lose a real booking).
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('agenda.meetings') IS NOT NULL AND (
       EXISTS (SELECT 1 FROM agenda.meetings WHERE booked_by NOT LIKE 'system:test%')
    OR EXISTS (SELECT 1 FROM agenda.booking_links WHERE origem <> 'teste')) THEN
    RAISE EXCEPTION '0001_agenda rollback refused: real bookings or links exist';
  END IF;
END
$guard$;

DROP SCHEMA IF EXISTS agenda CASCADE;

COMMIT;
