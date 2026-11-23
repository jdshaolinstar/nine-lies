/* @bruin
name: public.captain_briefing
type: pg.sql
connection: warehouse
description: What the dog captain studies before a match. Habits of past crews, as shares of all past matches.
depends:
  - public.claims
materialization:
  type: view
columns:
  - name: habit
    checks:
      - name: accepted_values
        value: [first_generator, caught_in, killed_in]
  - name: share
    checks:
      - name: non_negative
@bruin */
with first_gen as (
  select distinct on (match_id) match_id, room
  from claims
  where kind = 'going' and room in ('gennorth', 'gensouth')
  order by match_id, t
),
habits as (
  select 'first_generator' as habit, room from first_gen
  union all
  select 'caught_in', coalesce(data->>'room', room) from events where type = 'captured'
  union all
  select 'killed_in', coalesce(data->>'room', room) from events where type = 'kill'
)
select habit, room, count(*) as n,
  round(100.0 * count(*) / sum(count(*)) over (partition by habit)) as share
from habits
where room is not null
group by habit, room
