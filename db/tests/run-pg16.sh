#!/usr/bin/env bash
# Prove db/migrations/0001_agenda.sql in a throwaway PostgreSQL 16 (same
# major + Alpine image family as postgres_locuz). Never touches db_locuz.
#   bash db/tests/run-pg16.sh
set -euo pipefail
cd "$(dirname "$0")/.."
name="pg16-agenda-test-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=x postgres:16-alpine >/dev/null
trap 'docker stop "$name" >/dev/null' EXIT
until docker exec "$name" pg_isready -U postgres -q 2>/dev/null; do sleep 0.5; done
sleep 1
P() { docker exec -i "$name" psql -q -X -U postgres -v ON_ERROR_STOP=1 "$@"; }

P -f - < migrations/0001_agenda.sql
P -f - < migrations/0001_agenda.sql
echo "applied 0001_agenda twice"

pass=0; fail=0
while IFS= read -r -d '' block; do
  title=$(sed -n 's/^-- @test //p' <<<"$block" | head -1)
  [ -z "$title" ] && continue
  if out=$(P -c "$block" </dev/null 2>&1); then echo "  PASS  $title"; pass=$((pass+1))
  else echo "  FAIL  $title"; echo "$out" | sed 's/^/        /'; fail=$((fail+1)); fi
done < <(python3 -I -c 'import re,sys
for b in re.split(r"(?m)^(?=-- @test )", open(sys.argv[1]).read())[1:]:
    sys.stdout.write(b + "\0")' tests/agenda_test.sql)

# Rollback: refuses while a real booking exists, then drops cleanly.
P -c "INSERT INTO agenda.meetings (calendar_id, starts_at, ends_at, phone, booked_by)
      VALUES ('x', now()+interval '30 days', now()+interval '30 days 15 minutes', '5521900000000', 'n8n:wf-locuz')"
if P -f - < rollbacks/0001_agenda.rollback.sql >/dev/null 2>&1; then
  echo "  FAIL  rollback refuses with a real booking"; fail=$((fail+1))
else echo "  PASS  rollback refuses with a real booking"; pass=$((pass+1)); fi
P -c "DELETE FROM agenda.meetings WHERE booked_by = 'n8n:wf-locuz'"
P -f - < rollbacks/0001_agenda.rollback.sql
if [ "$(P -At -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'agenda'")" = 0 ]; then
  echo "  PASS  rollback drops the schema"; pass=$((pass+1))
else echo "  FAIL  rollback drops the schema"; fail=$((fail+1)); fi
P -f - < migrations/0001_agenda.sql && echo "re-applied after rollback"

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
