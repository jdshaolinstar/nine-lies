/* @bruin
name: public.mole_learning
type: pg.sql
connection: warehouse
description: How often each mole tactic won without being caught. The mole reads this before the next match.
materialization:
  type: view
columns:
  - name: tactic
    checks:
      - name: not_null
      - name: unique
  - name: plays
    checks:
      - name: positive
@bruin */
select tactic, count(*) as plays,
  count(*) filter (where winner = 'mole' and not mole_caught) as wins
from matches
where tactic is not null
group by tactic
