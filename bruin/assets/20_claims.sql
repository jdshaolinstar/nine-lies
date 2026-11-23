/* @bruin
name: public.claims
type: pg.sql
connection: warehouse
description: What cats said on the radio about where they were or were going.
materialization:
  type: view
columns:
  - name: speaker
    checks:
      - name: not_null
  - name: kind
    checks:
      - name: accepted_values
        value: [at, going]
@bruin */
select match_id, t, actor as speaker, target as whispered_to, data->>'kind' as kind, data->>'room' as room
from events
where type = 'radio' and actor is not null and data->>'kind' in ('at', 'going')
