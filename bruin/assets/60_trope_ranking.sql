/* @bruin
name: public.trope_ranking
type: pg.sql
connection: warehouse
description: Which spy set pieces the live web talks about most. Picks the next mission.
materialization:
  type: view
columns:
  - name: trope
    checks:
      - name: not_null
      - name: unique
  - name: pages
    checks:
      - name: positive
@bruin */
select trope, count(distinct url) as pages,
  round(sum(1 / sqrt(greatest(coalesce(rank, 1), 1)))::numeric, 2) as score
from trope_evidence
group by trope
