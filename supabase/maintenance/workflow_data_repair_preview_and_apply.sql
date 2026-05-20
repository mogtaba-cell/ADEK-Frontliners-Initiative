-- Workflow data repair: preview first, then run the APPLY section only after reviewing.
-- This script avoids changing assigned users except where an assignment is clearly in the wrong place.

-- ============================================================
-- 1) PREVIEW CHECKS
-- ============================================================

-- A. Assignments paused for correction/review but incorrectly carrying completed_at.
select
  'paused_assignment_has_completed_at' as issue,
  a.id as assignment_id,
  s.reference_id,
  a.phase,
  a.status,
  a.completed_at,
  p.full_name as assigned_user,
  p.email
from public.assignments a
join public.submissions s on s.id = a.submission_id
left join public.profiles p on p.id = a.assigned_to
where a.status::text in ('returned_for_correction', 'sent_for_review')
  and a.completed_at is not null
order by a.phase, s.reference_id;

-- B. Active reviewer tasks that should not be with reviewers yet.
select
  'reviewer_task_not_ready' as issue,
  fr.id as final_review_assignment_id,
  s.reference_id,
  s.workflow_status,
  reviewer.full_name as reviewer_name,
  reviewer.email as reviewer_email,
  not exists (
    select 1 from public.assignments a
    where a.submission_id = s.id and a.phase = 'adek_evaluation' and a.status = 'completed' and a.completed_at is not null
  ) as missing_completed_adek,
  not exists (
    select 1 from public.assignments a
    where a.submission_id = s.id and a.phase = 'proofreading' and a.status = 'completed' and a.completed_at is not null
  ) as missing_completed_general_proofreading,
  exists (
    select 1 from public.assignments a
    where a.submission_id = s.id and a.phase = 'coordinator_check' and a.status::text in ('assigned', 'in_progress')
  ) as has_active_correction,
  exists (
    select 1 from public.assignments a
    where a.submission_id = s.id and a.phase = 'management_review' and a.status::text in ('assigned', 'in_progress')
  ) as has_active_management
from public.assignments fr
join public.submissions s on s.id = fr.submission_id
left join public.profiles reviewer on reviewer.id = fr.assigned_to
where fr.phase = 'final_review'
  and fr.status::text in ('assigned', 'in_progress')
  and (
    not exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'adek_evaluation' and a.status = 'completed' and a.completed_at is not null
    )
    or not exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'proofreading' and a.status = 'completed' and a.completed_at is not null
    )
    or exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'coordinator_check' and a.status::text in ('assigned', 'in_progress')
    )
    or exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'management_review' and a.status::text in ('assigned', 'in_progress')
    )
  )
order by s.reference_id;

-- C. Coordinator correction tasks missing source/requester links.
select
  'coordinator_task_missing_links' as issue,
  c.id as coordinator_assignment_id,
  s.reference_id,
  c.status,
  c.requested_by_user_id,
  c.return_to_user_id,
  c.correction_source_phase,
  c.correction_source_assignment_id,
  c.correction_reason
from public.assignments c
join public.submissions s on s.id = c.submission_id
where c.phase = 'coordinator_check'
  and c.status::text in ('assigned', 'in_progress')
  and (
    c.requested_by_user_id is null
    or c.return_to_user_id is null
    or c.correction_source_phase is null
    or c.correction_source_assignment_id is null
    or c.correction_reason is null
    or trim(c.correction_reason) = ''
  )
order by s.reference_id;

-- D. Duplicate open same-phase assignments. Should be zero before/after repair.
select
  'duplicate_open_same_phase' as issue,
  a.submission_id,
  s.reference_id,
  a.phase,
  count(*) as open_count,
  string_agg(a.status::text, ', ' order by a.status::text) as statuses,
  string_agg(p.full_name || ' <' || p.email || '>', ', ' order by p.full_name) as assigned_users
from public.assignments a
join public.submissions s on s.id = a.submission_id
left join public.profiles p on p.id = a.assigned_to
where a.status::text in ('assigned', 'in_progress', 'returned_for_correction', 'sent_for_review')
group by a.submission_id, s.reference_id, a.phase
having count(*) > 1
order by a.phase, s.reference_id;

-- E. Disqualified submissions missing completed_at.
select
  'disqualified_missing_completed_at' as issue,
  s.id,
  s.reference_id,
  s.workflow_status,
  s.evaluation_decision,
  s.management_decision,
  s.completed_at
from public.submissions s
where (
    s.workflow_status::text = 'disqualified'
    or s.evaluation_decision = 'disqualified'
    or s.management_decision = 'disqualified'
  )
  and s.completed_at is null
order by s.reference_id;

-- ============================================================
-- 2) APPLY SAFE REPAIRS
--    Run this section only after checking the previews above.
-- ============================================================

begin;

-- Paused source-user assignments are not complete. Clear completed_at.
update public.assignments a
set
  completed_at = null,
  updated_at = now()
where a.status::text in ('returned_for_correction', 'sent_for_review')
  and a.completed_at is not null;

-- Ensure disqualified submissions are terminal/closed.
update public.submissions s
set
  workflow_status = 'disqualified',
  completed_at = coalesce(s.completed_at, now()),
  updated_at = now()
where s.workflow_status::text = 'disqualified'
   or s.evaluation_decision = 'disqualified'
   or s.management_decision = 'disqualified';

-- Active coordinator corrections control the submission status.
update public.submissions s
set
  workflow_status = 'returned_for_correction',
  updated_at = now()
where exists (
  select 1 from public.assignments c
  where c.submission_id = s.id
    and c.phase = 'coordinator_check'
    and c.status::text in ('assigned', 'in_progress')
)
and s.workflow_status::text <> 'returned_for_correction';

-- Active management tasks control the submission status, unless it is in coordinator correction.
update public.submissions s
set
  workflow_status = 'needs_management_review',
  updated_at = now()
where exists (
  select 1 from public.assignments m
  where m.submission_id = s.id
    and m.phase = 'management_review'
    and m.status::text in ('assigned', 'in_progress')
)
and not exists (
  select 1 from public.assignments c
  where c.submission_id = s.id
    and c.phase = 'coordinator_check'
    and c.status::text in ('assigned', 'in_progress')
)
and s.workflow_status::text <> 'needs_management_review';

-- Active ADEK assignments should be visible in evaluator workspace unless in correction/management.
update public.submissions s
set
  workflow_status = 'ready_for_adek',
  updated_at = now()
where exists (
  select 1 from public.assignments a
  where a.submission_id = s.id
    and a.phase = 'adek_evaluation'
    and a.status::text in ('assigned', 'in_progress')
)
and not exists (
  select 1 from public.assignments c
  where c.submission_id = s.id and c.phase = 'coordinator_check' and c.status::text in ('assigned', 'in_progress')
)
and not exists (
  select 1 from public.assignments m
  where m.submission_id = s.id and m.phase = 'management_review' and m.status::text in ('assigned', 'in_progress')
)
and s.workflow_status::text <> 'ready_for_adek';

-- Active proofreader/literary tasks should be selected_for_proofreading unless in correction/management.
update public.submissions s
set
  workflow_status = 'selected_for_proofreading',
  updated_at = now()
where exists (
  select 1 from public.assignments a
  where a.submission_id = s.id
    and a.phase in ('proofreading', 'literary_proofreading')
    and a.status::text in ('assigned', 'in_progress')
)
and not exists (
  select 1 from public.assignments c
  where c.submission_id = s.id and c.phase = 'coordinator_check' and c.status::text in ('assigned', 'in_progress')
)
and not exists (
  select 1 from public.assignments m
  where m.submission_id = s.id and m.phase = 'management_review' and m.status::text in ('assigned', 'in_progress')
)
and s.workflow_status::text <> 'selected_for_proofreading';

-- Cancel active reviewer tasks that were created too early. This is the only place where wrong-level assignments are changed.
update public.assignments fr
set
  status = 'cancelled',
  updated_at = now(),
  reassignment_reason = coalesce(fr.reassignment_reason, 'Cancelled by workflow repair: previous stages were not completed.')
from public.submissions s
where s.id = fr.submission_id
  and fr.phase = 'final_review'
  and fr.status::text in ('assigned', 'in_progress')
  and (
    not exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'adek_evaluation' and a.status = 'completed' and a.completed_at is not null
    )
    or not exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'proofreading' and a.status = 'completed' and a.completed_at is not null
    )
    or exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'coordinator_check' and a.status::text in ('assigned', 'in_progress')
    )
    or exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'management_review' and a.status::text in ('assigned', 'in_progress')
    )
  );

commit;

-- ============================================================
-- 3) FINAL VALIDATION
-- ============================================================

select
  'duplicate_open_same_phase' as check_name,
  count(*) as issue_count
from (
  select submission_id, phase
  from public.assignments
  where status::text in ('assigned', 'in_progress', 'returned_for_correction', 'sent_for_review')
  group by submission_id, phase
  having count(*) > 1
) x
union all
select
  'paused_assignment_has_completed_at',
  count(*)
from public.assignments
where status::text in ('returned_for_correction', 'sent_for_review')
  and completed_at is not null
union all
select
  'disqualified_missing_completed_at',
  count(*)
from public.submissions
where (workflow_status::text = 'disqualified' or evaluation_decision = 'disqualified' or management_decision = 'disqualified')
  and completed_at is null
union all
select
  'active_final_review_not_ready',
  count(*)
from public.assignments fr
join public.submissions s on s.id = fr.submission_id
where fr.phase = 'final_review'
  and fr.status::text in ('assigned', 'in_progress')
  and (
    not exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'adek_evaluation' and a.status = 'completed' and a.completed_at is not null
    )
    or not exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'proofreading' and a.status = 'completed' and a.completed_at is not null
    )
    or exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'coordinator_check' and a.status::text in ('assigned', 'in_progress')
    )
    or exists (
      select 1 from public.assignments a
      where a.submission_id = s.id and a.phase = 'management_review' and a.status::text in ('assigned', 'in_progress')
    )
  );
