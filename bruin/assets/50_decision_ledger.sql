/* @bruin
name: public.decision_ledger
type: pg.sql
connection: warehouse
description: Every decision an agent made, and why. Used for post-match review.
materialization:
  type: view
columns:
  - name: who
    checks:
      - name: not_null
  - name: source
    checks:
      - name: accepted_values
        value: [llm, rule, bruin]
@bruin */
select match_id, t, data->>'who' as who, data->>'source' as source, data->>'goal' as goal, data->>'reason' as reason
from events
where type = 'decision'
