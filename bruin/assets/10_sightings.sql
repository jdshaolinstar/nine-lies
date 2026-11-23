/* @bruin
name: public.sightings
type: pg.sql
connection: warehouse
description: Every time one cat saw another, and where. The ground truth for alibis.
materialization:
  type: view
columns:
  - name: match_id
    checks:
      - name: not_null
  - name: observer
    checks:
      - name: not_null
  - name: seen
    checks:
      - name: not_null
@bruin */
select match_id, t, actor as observer, target as seen, data->>'room' as room
from events
where type = 'saw'
