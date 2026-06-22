-- Rater score persistence hotfix / repair
-- Date: 2026-06-22
-- Purpose:
--   1) Prove which artistic_ranking assignments were marked completed without scores.
--   2) Back up those rows.
--   3) Reopen them so raters can submit the rubric again after the code hotfix is deployed.
--   4) Add a database guard so an artistic_ranking assignment cannot be completed unless
--      the submission already has the rubric scores saved.
--
-- Recommended order:
--   A. Deploy the code hotfix first.
--   B. Run DIAGNOSTIC 1 and DIAGNOSTIC 2.
--   C. Run BACKUP.
--   D. Run REOPEN.
--   E. Run DATABASE GUARD.
--   F. Run VERIFY.

-- DIAGNOSTIC 1: Current rater completion health.
select
  count(*) filter (
    where a.phase::text = 'artistic_ranking'
      and a.status::text = 'completed'
      and a.decision::text = 'completed'
  ) as completed_rater_assignments,

  count(*) filter (
    where a.phase::text = 'artistic_ranking'
      and a.status::text = 'completed'
      and a.decision::text = 'completed'
      and s.artistic_rubric_total_score is not null
      and s.artistic_quality_creativity_score is not null
      and s.initiative_relation_score is not null
      and s.age_appropriateness_score is not null
      and s.artistic_ranking_completed_at is not null
  ) as completed_with_saved_scores,

  count(*) filter (
    where a.phase::text = 'artistic_ranking'
      and a.status::text = 'completed'
      and a.decision::text = 'completed'
      and s.artistic_rubric_total_score is null
      and s.artistic_quality_creativity_score is null
      and s.initiative_relation_score is null
      and s.age_appropriateness_score is null
      and s.artistic_ranking is null
      and s.artistic_ranking_completed_at is null
  ) as completed_without_saved_scores
from public.assignments a
join public.submissions s on s.id = a.submission_id;

-- DIAGNOSTIC 2: Who needs reopened work.
select
  p.full_name as rater_name,
  p.email as rater_email,
  s.categorized_pathway,
  count(*) as completed_without_saved_scores
from public.assignments a
join public.submissions s on s.id = a.submission_id
left join public.profiles p on p.id = a.assigned_to
where a.phase::text = 'artistic_ranking'
  and a.status::text = 'completed'
  and a.decision::text = 'completed'
  and s.artistic_rubric_total_score is null
  and s.artistic_quality_creativity_score is null
  and s.initiative_relation_score is null
  and s.age_appropriateness_score is null
  and s.artistic_ranking is null
  and s.artistic_ranking_completed_at is null
group by p.full_name, p.email, s.categorized_pathway
order by completed_without_saved_scores desc, p.full_name, p.email, s.categorized_pathway;

-- BACKUP: Run once before any repair.
create table if not exists public.rater_unscored_completion_backup_20260622 as
select
  a.*,
  s.reference_id,
  s.categorized_pathway,
  s.workflow_status,
  s.artistic_quality_creativity_score,
  s.initiative_relation_score,
  s.age_appropriateness_score,
  s.artistic_rubric_total_score,
  s.artistic_ranking,
  s.artistic_ranking_completed_at,
  s.completed_at as submission_completed_at,
  now() as backed_up_at
from public.assignments a
join public.submissions s on s.id = a.submission_id
where a.phase::text = 'artistic_ranking'
  and a.status::text = 'completed'
  and a.decision::text = 'completed'
  and s.artistic_rubric_total_score is null
  and s.artistic_quality_creativity_score is null
  and s.initiative_relation_score is null
  and s.age_appropriateness_score is null
  and s.artistic_ranking is null
  and s.artistic_ranking_completed_at is null;

-- REOPEN: Reopen only unscored completed rater assignments.
-- Keeps the original rater assigned, so the same rater can re-enter the rubric.
begin;

with targets as (
  select a.id, a.submission_id
  from public.assignments a
  join public.submissions s on s.id = a.submission_id
  where a.phase::text = 'artistic_ranking'
    and a.status::text = 'completed'
    and a.decision::text = 'completed'
    and s.artistic_rubric_total_score is null
    and s.artistic_quality_creativity_score is null
    and s.initiative_relation_score is null
    and s.age_appropriateness_score is null
    and s.artistic_ranking is null
    and s.artistic_ranking_completed_at is null
), reopened_assignments as (
  update public.assignments a
  set
    status = 'assigned',
    decision = null,
    started_at = null,
    completed_at = null,
    updated_at = now()
  from targets t
  where a.id = t.id
  returning a.id, a.submission_id
), reset_submissions as (
  update public.submissions s
  set
    workflow_status = 'ready_for_artistic_ranking',
    completed_at = null,
    updated_at = now()
  where s.id in (select distinct submission_id from targets)
    and s.artistic_rubric_total_score is null
    and s.artistic_ranking_completed_at is null
  returning s.id
)
select
  (select count(*) from targets) as unscored_completed_rater_tasks_found,
  (select count(*) from reopened_assignments) as assignments_reopened,
  (select count(*) from reset_submissions) as submissions_reset_to_ready_for_artistic_ranking;

commit;

-- DATABASE GUARD: Prevent this bug from happening again.
-- This trigger allows completion only when the submission already has saved rubric scores.
create or replace function public.prevent_unscored_artistic_ranking_completion()
returns trigger
language plpgsql
as $$
begin
  if new.phase::text = 'artistic_ranking'
     and new.status::text = 'completed'
     and coalesce(new.decision::text, '') = 'completed' then
    if not exists (
      select 1
      from public.submissions s
      where s.id = new.submission_id
        and s.artistic_quality_creativity_score is not null
        and s.initiative_relation_score is not null
        and s.age_appropriateness_score is not null
        and s.artistic_rubric_total_score is not null
        and nullif(s.artistic_ranking, '') is not null
        and s.artistic_ranking_completed_at is not null
    ) then
      raise exception
        'Cannot complete artistic_ranking assignment %. Save the rubric scores on submission % first.',
        new.id,
        new.submission_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_unscored_artistic_ranking_completion on public.assignments;

create trigger trg_prevent_unscored_artistic_ranking_completion
before insert or update of status, decision on public.assignments
for each row
execute function public.prevent_unscored_artistic_ranking_completion();

-- VERIFY: After repair, completed_without_saved_scores must be 0.
select
  count(*) filter (
    where a.phase::text = 'artistic_ranking'
      and a.status::text = 'completed'
      and a.decision::text = 'completed'
  ) as completed_rater_assignments,

  count(*) filter (
    where a.phase::text = 'artistic_ranking'
      and a.status::text = 'completed'
      and a.decision::text = 'completed'
      and s.artistic_rubric_total_score is not null
      and s.artistic_quality_creativity_score is not null
      and s.initiative_relation_score is not null
      and s.age_appropriateness_score is not null
      and s.artistic_ranking_completed_at is not null
  ) as completed_with_saved_scores,

  count(*) filter (
    where a.phase::text = 'artistic_ranking'
      and a.status::text = 'completed'
      and a.decision::text = 'completed'
      and s.artistic_rubric_total_score is null
      and s.artistic_ranking_completed_at is null
  ) as completed_without_saved_scores,

  count(*) filter (
    where a.phase::text = 'artistic_ranking'
      and a.status::text in ('assigned', 'in_progress')
  ) as active_rater_queue
from public.assignments a
join public.submissions s on s.id = a.submission_id;

analyze public.assignments;
analyze public.submissions;
