/* @bruin
name: public.alibi_findings
type: pg.sql
connection: warehouse
description: Contradictions and leads for the in-game alibi scan. Agents' claims vs what others saw.
depends:
  - public.sightings
  - public.claims
materialization:
  type: view
columns:
  - name: kind
    checks:
      - name: accepted_values
        value: [broken_alibi, last_seen_with, leak]
  - name: detail
    checks:
      - name: not_null
@bruin */
with broken as (
  select distinct on (c.match_id, c.speaker, c.t)
    c.match_id, c.t, 'broken_alibi' as kind, c.speaker as suspect, c.speaker as subject,
    initcap(c.speaker) || ' claimed ' || c.room || ' at ' || round(c.t::numeric) || 's, but ' || initcap(s.observer)
      || ' saw them in ' || s.room || ' at ' || round(s.t::numeric) || 's' as detail
  from claims c
  join sightings s on s.match_id = c.match_id and s.seen = c.speaker and s.room <> c.room and abs(s.t - c.t) <= 5
  where c.kind = 'at'
  order by c.match_id, c.speaker, c.t, abs(s.t - c.t)
),
last_seen as (
  select distinct on (match_id, seen) match_id, seen, t, room, observer
  from sightings
  order by match_id, seen, t desc
),
near as (
  select l.match_id, l.t, 'last_seen_with' as kind, null::text as suspect, l.seen as subject,
    initcap(l.seen) || ' was last seen in ' || l.room || ' at ' || round(l.t::numeric) || 's, near '
      || (select string_agg(distinct initcap(x.who), ', ') from (
            select s.seen as who from sightings s
            where s.match_id = l.match_id and s.room = l.room and s.seen <> l.seen and abs(s.t - l.t) <= 8
            union select l.observer) x) as detail
  from last_seen l
),
leaks as (
  select e.match_id, e.t, 'leak' as kind, null::text as suspect, null::text as subject,
    'Dogs were tipped off about ' || (e.data->>'room') || ' at ' || round(e.t::numeric) || 's. '
      || coalesce('Whispered only to: ' || (
          select string_agg(distinct initcap(c.whispered_to), ', ') from claims c
          where c.match_id = e.match_id and c.room = e.data->>'room' and c.whispered_to is not null and c.t between e.t - 25 and e.t),
        'It went out on open radio') as detail
  from events e
  where e.type = 'leak'
)
select * from broken
union all
select * from near
union all
select * from leaks
