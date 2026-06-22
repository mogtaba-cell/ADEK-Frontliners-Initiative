-- Rater workflow diagnostics and safe repair helpers
-- Run diagnostic SELECTs first. Only run APPLY sections after reviewing their preview output.

-- 1) Inspect one reference end-to-end.
select
  s.id as submission_id,
  s.reference_id,
  s.workflow_status,
  s.categorized_pathway,
  s.categorization_completed_at,
  s.artistic_ranking,
  s.artistic_quality_creativity_score,
  s.initiative_relation_score,
  s.age_appropriateness_score,
  s.artistic_rubric_total_score,
  s.artistic_ranking_completed_at,
  s.completed_at
from public.submissions s
where s.reference_id = '082247B2-D0DA-4FEB-B4DA-E89130D0A7EA';

select
  a.id as assignment_id,
  a.phase,
  a.status,
  a.decision,
  a.assigned_to,
  p.full_name,
  p.email,
  a.created_at,
  a.started_at,
  a.completed_at,
  a.updated_at,
  a.correction_reason,
  a.correction_source_phase,
  a.correction_source_assignment_id
from public.assignments a
join public.submissions s on s.id = a.submission_id
left join public.profiles p on p.id = a.assigned_to
where s.reference_id = '082247B2-D0DA-4FEB-B4DA-E89130D0A7EA'
order by a.created_at, a.phase;

-- 2) Preview stale active rater rows for submissions that are already artistically ranked.
-- These rows can make the rater queue/counts disagree with the completed submission state.
select
  s.reference_id,
  s.workflow_status,
  s.artistic_ranking,
  s.artistic_ranking_completed_at,
  a.id as assignment_id,
  a.status as assignment_status,
  a.decision as assignment_decision,
  p.full_name,
  p.email,
  a.created_at,
  a.completed_at,
  a.updated_at
from public.submissions s
join public.assignments a on a.submission_id = s.id
left join public.profiles p on p.id = a.assigned_to
where a.phase::text = 'artistic_ranking'
  and a.status::text in ('assigned', 'in_progress', 'returned_for_correction', 'sent_for_review')
  and s.artistic_ranking_completed_at is not null
order by s.artistic_ranking_completed_at desc, s.reference_id;

-- 3) Preview completed artistic ranking submissions with no completed rater assignment.
-- These need manual review if there is more than one active rater row.
select
  s.reference_id,
  s.workflow_status,
  s.artistic_ranking,
  s.artistic_ranking_completed_at,
  count(a.id) filter (where a.status::text = 'completed') as completed_rater_assignments,
  count(a.id) filter (where a.status::text in ('assigned','in_progress','returned_for_correction','sent_for_review')) as active_or_stale_rater_assignments,
  string_agg(coalesce(p.email, a.assigned_to::text) || ':' || a.status::text, ', ' order by a.created_at) as rater_rows
from public.submissions s
left join public.assignments a
  on a.submission_id = s.id
  and a.phase::text = 'artistic_ranking'
left join public.profiles p on p.id = a.assigned_to
where s.artistic_ranking_completed_at is not null
group by s.id, s.reference_id, s.workflow_status, s.artistic_ranking, s.artistic_ranking_completed_at
having count(a.id) filter (where a.status::text = 'completed') = 0
order by s.artistic_ranking_completed_at desc;

-- 4) Preview duplicate active rater assignments on the same submission.
select
  s.reference_id,
  s.workflow_status,
  s.artistic_ranking_completed_at,
  count(*) as active_rater_assignments,
  string_agg(coalesce(p.email, a.assigned_to::text) || ':' || a.status::text, ', ' order by a.created_at) as active_rows
from public.assignments a
join public.submissions s on s.id = a.submission_id
left join public.profiles p on p.id = a.assigned_to
where a.phase::text = 'artistic_ranking'
  and a.status::text in ('assigned','in_progress','returned_for_correction','sent_for_review')
group by s.id, s.reference_id, s.workflow_status, s.artistic_ranking_completed_at
having count(*) > 1
order by active_rater_assignments desc, s.reference_id;

-- 5) Rater progress by user using assignment rows.
select
  p.full_name,
  p.email,
  count(a.id) filter (where a.phase::text = 'artistic_ranking' and a.status::text in ('assigned','in_progress')) as remaining,
  count(a.id) filter (where a.phase::text = 'artistic_ranking' and a.status::text = 'completed') as completed,
  count(a.id) filter (where a.phase::text = 'artistic_ranking' and a.status::text in ('returned_for_correction','sent_for_review')) as invalid_for_rater
from public.profiles p
left join public.assignments a on a.assigned_to = p.id
where p.role::text = 'rater'
group by p.id, p.full_name, p.email
order by remaining desc, completed desc, p.full_name;

-- APPLY A: Cancel stale active rater rows when the same submission already has a completed rater assignment.
-- Safe because it only cancels duplicate active rows where another rater assignment is already completed.
begin;
with stale as (
  select a.id
  from public.assignments a
  where a.phase::text = 'artistic_ranking'
    and a.status::text in ('assigned','in_progress','returned_for_correction','sent_for_review')
    and exists (
      select 1
      from public.assignments done
      where done.submission_id = a.submission_id
        and done.phase::text = 'artistic_ranking'
        and done.status::text = 'completed'
    )
), updated as (
  update public.assignments a
  set
    status = 'cancelled',
    decision = 'cancelled_duplicate_after_rater_completed',
    completed_at = now(),
    updated_at = now()
  where a.id in (select id from stale)
  returning a.id
)
select count(*) as duplicate_active_rater_rows_cancelled from updated;
commit;

-- APPLY B: For completed/ranked submissions with exactly one stale active rater row and zero completed rater rows,
-- mark that one rater assignment completed so the user's Completed KPI matches the saved score.
begin;
with candidate_submissions as (
  select
    s.id as submission_id,
    s.artistic_ranking_completed_at,
    count(a.id) filter (where a.status::text = 'completed') as completed_rows,
    count(a.id) filter (where a.status::text in ('assigned','in_progress','returned_for_correction','sent_for_review')) as active_rows
  from public.submissions s
  join public.assignments a
    on a.submission_id = s.id
   and a.phase::text = 'artistic_ranking'
  where s.artistic_ranking_completed_at is not null
  group by s.id, s.artistic_ranking_completed_at
  having count(a.id) filter (where a.status::text = 'completed') = 0
     and count(a.id) filter (where a.status::text in ('assigned','in_progress','returned_for_correction','sent_for_review')) = 1
), target_assignments as (
  select a.id, c.artistic_ranking_completed_at
  from public.assignments a
  join candidate_submissions c on c.submission_id = a.submission_id
  where a.phase::text = 'artistic_ranking'
    and a.status::text in ('assigned','in_progress','returned_for_correction','sent_for_review')
), updated as (
  update public.assignments a
  set
    status = 'completed',
    decision = 'completed',
    completed_at = coalesce(t.artistic_ranking_completed_at, now()),
    updated_at = now()
  from target_assignments t
  where a.id = t.id
  returning a.id
)
select count(*) as stale_single_rater_rows_marked_completed from updated;
commit;

-- APPLY C: For rater assignments incorrectly stuck in returned/sent-for-review while the submission is still ready for rating,
-- reopen exactly one row only when there is no other active/completed artistic ranking assignment for that submission.
begin;
with candidates as (
  select
    a.id,
    row_number() over (partition by a.submission_id order by a.updated_at desc nulls last, a.created_at desc nulls last, a.id) as rn,
    count(*) filter (where a.status::text in ('assigned','in_progress','completed')) over (partition by a.submission_id) as good_rows
  from public.assignments a
  join public.submissions s on s.id = a.submission_id
  where a.phase::text = 'artistic_ranking'
    and a.status::text in ('returned_for_correction','sent_for_review')
    and s.workflow_status::text = 'ready_for_artistic_ranking'
    and s.artistic_ranking_completed_at is null
), updated as (
  update public.assignments a
  set
    status = 'assigned',
    decision = null,
    completed_at = null,
    updated_at = now()
  from candidates c
  where a.id = c.id
    and c.rn = 1
    and c.good_rows = 0
  returning a.id
)
select count(*) as invalid_rater_rows_reopened from updated;
commit;

analyze public.assignments;
analyze public.submissions;
