-- Reassign active Artistic Grading tasks to raters according to Admin > Users > Rater Pathway Links.
-- Safe for current setup where no rater tasks are completed yet.
-- Completed artistic_ranking assignments are not changed.

-- 1) Preview pathways that still do not have active raters configured.
select
  s.categorized_pathway,
  count(*) as active_tasks_without_configured_rater
from public.assignments a
join public.submissions s on s.id = a.submission_id
where a.phase::text = 'artistic_ranking'
  and a.status::text in ('assigned', 'in_progress')
  and not exists (
    select 1
    from public.rater_pathway_assignments rpa
    join public.profiles p on p.id = rpa.rater_id
    where rpa.pathway = s.categorized_pathway
      and p.role::text = 'rater'
      and p.is_active = true
  )
group by s.categorized_pathway
order by active_tasks_without_configured_rater desc;

-- 2) Preview current active task counts by pathway and rater.
select
  s.categorized_pathway,
  p.full_name,
  p.email,
  a.status::text as status,
  count(*) as active_tasks
from public.assignments a
join public.submissions s on s.id = a.submission_id
join public.profiles p on p.id = a.assigned_to
where a.phase::text = 'artistic_ranking'
  and a.status::text in ('assigned', 'in_progress')
group by s.categorized_pathway, p.full_name, p.email, a.status::text
order by s.categorized_pathway, active_tasks desc, p.full_name;

-- 3) Reassign active tasks evenly inside each categorized pathway.
begin;

with active_tasks as (
  select
    a.id as assignment_id,
    s.categorized_pathway,
    row_number() over (
      partition by s.categorized_pathway
      order by a.created_at, a.id
    ) as task_number
  from public.assignments a
  join public.submissions s on s.id = a.submission_id
  where a.phase::text = 'artistic_ranking'
    and a.status::text in ('assigned', 'in_progress')
    and s.categorized_pathway is not null
),
active_pathway_raters as (
  select
    rpa.pathway,
    rpa.rater_id,
    row_number() over (
      partition by rpa.pathway
      order by p.full_name, p.email, p.id
    ) as rater_number,
    count(*) over (partition by rpa.pathway) as rater_count
  from public.rater_pathway_assignments rpa
  join public.profiles p on p.id = rpa.rater_id
  where p.role::text = 'rater'
    and p.is_active = true
),
assignment_plan as (
  select
    t.assignment_id,
    r.rater_id as new_assigned_to
  from active_tasks t
  join active_pathway_raters r
    on r.pathway = t.categorized_pathway
   and r.rater_number = ((t.task_number - 1) % r.rater_count) + 1
)
update public.assignments a
set
  assigned_to = ap.new_assigned_to,
  updated_at = now()
from assignment_plan ap
where a.id = ap.assignment_id
  and a.assigned_to is distinct from ap.new_assigned_to;

commit;

-- 4) Verify final active distribution by pathway and rater.
select
  s.categorized_pathway,
  p.full_name,
  p.email,
  count(*) as active_tasks
from public.assignments a
join public.submissions s on s.id = a.submission_id
join public.profiles p on p.id = a.assigned_to
where a.phase::text = 'artistic_ranking'
  and a.status::text in ('assigned', 'in_progress')
group by s.categorized_pathway, p.full_name, p.email
order by s.categorized_pathway, active_tasks desc, p.full_name;
