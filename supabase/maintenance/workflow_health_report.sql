/*
  Workflow Health Report
  Purpose:
  Finds workflow/assignment inconsistencies before they appear as KPI,
  queue, or task-flow problems.

  Safe to run:
  - Read-only
  - Does not update data
  - Casts enum columns to text so UNION ALL works correctly
*/

with active_assignments as (
  select
    a.*
  from public.assignments a
  where a.status::text in (
    'assigned',
    'in_progress',
    'returned_for_correction',
    'sent_for_review'
  )
),

active_coordinator_tasks as (
  select
    a.*
  from public.assignments a
  where a.phase::text = 'coordinator_check'
    and a.status::text in ('assigned', 'in_progress')
),

active_management_tasks as (
  select
    a.*
  from public.assignments a
  where a.phase::text = 'management_review'
    and a.status::text in ('assigned', 'in_progress')
),

issue_rows as (

  /*
    1. Submission says returned_for_correction,
       but there is no active coordinator task.
  */
  select
    'returned_for_correction_without_active_coordinator_task'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    null::uuid as assignment_id,
    null::text as phase,
    null::text as proofreader_type,
    null::text as status,
    null::text as decision,
    null::text as correction_source_phase,
    null::uuid as correction_source_assignment_id,
    null::text as assigned_to_name,
    null::text as assigned_to_email,
    'Submission is returned_for_correction but has no active coordinator_check assignment.'::text as details,
    s.created_at::timestamptz as created_at,
    s.updated_at::timestamptz as updated_at
  from public.submissions s
  where s.workflow_status::text = 'returned_for_correction'
    and not exists (
      select 1
      from active_coordinator_tasks c
      where c.submission_id = s.id
    )

  union all

  /*
    2. Active coordinator task exists,
       but submission is not returned_for_correction.
  */
  select
    'active_coordinator_task_but_submission_not_returned_for_correction'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    'There is an active coordinator_check task, but the submission workflow_status is not returned_for_correction.'::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from active_coordinator_tasks a
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to
  where coalesce(s.workflow_status::text, '') <> 'returned_for_correction'

  union all

  /*
    3. Active coordinator task has no correction source assignment.
  */
  select
    'active_coordinator_task_missing_source_assignment_link'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    'Active coordinator_check task is missing correction_source_assignment_id.'::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from active_coordinator_tasks a
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to
  where a.correction_source_assignment_id is null

  union all

  /*
    4. Coordinator task points to a source assignment that no longer exists.
  */
  select
    'active_coordinator_task_source_assignment_not_found'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    'Active coordinator_check task points to a correction_source_assignment_id that was not found in assignments.'::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from active_coordinator_tasks a
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to
  left join public.assignments source_a
    on source_a.id = a.correction_source_assignment_id
  where a.correction_source_assignment_id is not null
    and source_a.id is null

  union all

  /*
    5. Source assignment is returned_for_correction,
       but there is no active coordinator task linked to that exact source.
  */
  select
    'returned_source_assignment_without_linked_active_coordinator_task'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    'Source assignment is returned_for_correction / needs_correction but no active coordinator_check task is linked to this source assignment.'::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from public.assignments a
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to
  where a.status::text = 'returned_for_correction'
    and a.decision::text = 'needs_correction'
    and a.phase::text <> 'coordinator_check'
    and not exists (
      select 1
      from active_coordinator_tasks c
      where c.submission_id = a.submission_id
        and c.correction_source_assignment_id = a.id
    )

  union all

  /*
    6. Duplicate active coordinator tasks for the same submission.
  */
  select
    'duplicate_active_coordinator_tasks_for_submission'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    ('Submission has more than one active coordinator_check task. Active coordinator task count = ' || dup.active_count::text)::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from active_coordinator_tasks a
  join (
    select
      submission_id,
      count(*) as active_count
    from active_coordinator_tasks
    group by submission_id
    having count(*) > 1
  ) dup
    on dup.submission_id = a.submission_id
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to

  union all

  /*
    7. Duplicate active coordinator tasks for the same source assignment.
  */
  select
    'duplicate_active_coordinator_tasks_for_same_source_assignment'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    ('Same correction_source_assignment_id has more than one active coordinator_check task. Active count = ' || dup.active_count::text)::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from active_coordinator_tasks a
  join (
    select
      correction_source_assignment_id,
      count(*) as active_count
    from active_coordinator_tasks
    where correction_source_assignment_id is not null
    group by correction_source_assignment_id
    having count(*) > 1
  ) dup
    on dup.correction_source_assignment_id = a.correction_source_assignment_id
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to

  union all

  /*
    8. Submission needs management review,
       but there is no active management_review task.
  */
  select
    'needs_management_review_without_active_management_task'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    null::uuid as assignment_id,
    null::text as phase,
    null::text as proofreader_type,
    null::text as status,
    null::text as decision,
    null::text as correction_source_phase,
    null::uuid as correction_source_assignment_id,
    null::text as assigned_to_name,
    null::text as assigned_to_email,
    'Submission workflow_status is needs_management_review but there is no active management_review assignment.'::text as details,
    s.created_at::timestamptz as created_at,
    s.updated_at::timestamptz as updated_at
  from public.submissions s
  where s.workflow_status::text = 'needs_management_review'
    and not exists (
      select 1
      from active_management_tasks m
      where m.submission_id = s.id
    )

  union all

  /*
    9. Active management task exists,
       but submission is not in needs_management_review.
  */
  select
    'active_management_task_but_submission_not_needs_management_review'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    'There is an active management_review task, but submission workflow_status is not needs_management_review.'::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from active_management_tasks a
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to
  where coalesce(s.workflow_status::text, '') <> 'needs_management_review'

  union all

  /*
    10. Duplicate active management tasks.
  */
  select
    'duplicate_active_management_tasks_for_submission'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    ('Submission has more than one active management_review task. Active management task count = ' || dup.active_count::text)::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from active_management_tasks a
  join (
    select
      submission_id,
      count(*) as active_count
    from active_management_tasks
    group by submission_id
    having count(*) > 1
  ) dup
    on dup.submission_id = a.submission_id
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to

  union all

  /*
    11. Management decision exists,
        but ADEK/source assignment is still stuck as needs_review/sent_for_review.
  */
  select
    'management_decision_exists_but_source_assignment_still_needs_review'::text as issue_type,
    'warning'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    ('Submission has management_decision = ' || coalesce(s.management_decision::text, 'null') || ' but assignment is still waiting for management review result.')::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from public.submissions s
  join public.assignments a
    on a.submission_id = s.id
  left join public.profiles p
    on p.id = a.assigned_to
  where s.management_decision::text in ('approved', 'disqualified')
    and a.status::text in ('sent_for_review', 'completed')
    and a.decision::text = 'needs_review'

  union all

  /*
    12. Disqualified submission still has active assignments.
  */
  select
    'disqualified_submission_has_active_assignment'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    'Submission is disqualified but still has an active assignment.'::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from public.submissions s
  join active_assignments a
    on a.submission_id = s.id
  left join public.profiles p
    on p.id = a.assigned_to
  where s.workflow_status::text = 'disqualified'

  union all

  /*
    13. Ready for ADEK but still has active coordinator/management correction/review task.
  */
  select
    'ready_for_adek_has_active_correction_or_review_assignment'::text as issue_type,
    'warning'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    'Submission is ready_for_adek but still has an active coordinator_check or management_review assignment.'::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from public.submissions s
  join active_assignments a
    on a.submission_id = s.id
  left join public.profiles p
    on p.id = a.assigned_to
  where s.workflow_status::text = 'ready_for_adek'
    and a.phase::text in ('coordinator_check', 'management_review')

  union all

  /*
    14. Completed or approved style final statuses still have active assignments.
    Adjust the workflow_status values here if your app uses different final names.
  */
  select
    'final_or_closed_submission_has_active_assignment'::text as issue_type,
    'warning'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    'Submission appears to be in a final/closed workflow status but still has an active assignment.'::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from public.submissions s
  join active_assignments a
    on a.submission_id = s.id
  left join public.profiles p
    on p.id = a.assigned_to
  where s.workflow_status::text in (
    'approved',
    'completed',
    'qualified',
    'exported',
    'archived'
  )

  union all

  /*
    15. Same submission has multiple active assignments for the same phase.
    This excludes proofreading/literary proofreader type separation.
  */
  select
    'duplicate_active_assignments_same_submission_same_phase'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    ('Submission has duplicate active assignments for the same phase. Active count = ' || dup.active_count::text)::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from active_assignments a
  join (
    select
      submission_id,
      phase::text as phase_text,
      count(*) as active_count
    from active_assignments
    where phase::text not in ('proofreading', 'literary_proofreading')
    group by submission_id, phase::text
    having count(*) > 1
  ) dup
    on dup.submission_id = a.submission_id
   and dup.phase_text = a.phase::text
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to
  where a.phase::text not in ('proofreading', 'literary_proofreading')

  union all

  /*
    16. Duplicate active proofreading assignments for the same proofreader type.
  */
  select
    'duplicate_active_proofreading_assignments_same_type'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    a.id::uuid as assignment_id,
    a.phase::text as phase,
    a.proofreader_type::text as proofreader_type,
    a.status::text as status,
    a.decision::text as decision,
    a.correction_source_phase::text as correction_source_phase,
    a.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    ('Submission has duplicate active proofreading assignments for the same phase/proofreader_type. Active count = ' || dup.active_count::text)::text as details,
    a.created_at::timestamptz as created_at,
    a.updated_at::timestamptz as updated_at
  from active_assignments a
  join (
    select
      submission_id,
      phase::text as phase_text,
      coalesce(proofreader_type::text, '') as proofreader_type_text,
      count(*) as active_count
    from active_assignments
    where phase::text in ('proofreading', 'literary_proofreading')
    group by
      submission_id,
      phase::text,
      coalesce(proofreader_type::text, '')
    having count(*) > 1
  ) dup
    on dup.submission_id = a.submission_id
   and dup.phase_text = a.phase::text
   and dup.proofreader_type_text = coalesce(a.proofreader_type::text, '')
  join public.submissions s
    on s.id = a.submission_id
  left join public.profiles p
    on p.id = a.assigned_to
  where a.phase::text in ('proofreading', 'literary_proofreading')

  union all

  /*
    17. Coordinator source phase does not match the actual source assignment phase.
  */
  select
    'coordinator_source_phase_does_not_match_source_assignment_phase'::text as issue_type,
    'warning'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    c.id::uuid as assignment_id,
    c.phase::text as phase,
    c.proofreader_type::text as proofreader_type,
    c.status::text as status,
    c.decision::text as decision,
    c.correction_source_phase::text as correction_source_phase,
    c.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    ('Coordinator task correction_source_phase = ' || coalesce(c.correction_source_phase::text, 'null') || ', but source assignment phase = ' || coalesce(source_a.phase::text, 'null') || '.')::text as details,
    c.created_at::timestamptz as created_at,
    c.updated_at::timestamptz as updated_at
  from active_coordinator_tasks c
  join public.submissions s
    on s.id = c.submission_id
  left join public.profiles p
    on p.id = c.assigned_to
  join public.assignments source_a
    on source_a.id = c.correction_source_assignment_id
  where c.correction_source_phase is not null
    and c.correction_source_phase::text <> source_a.phase::text

  union all

  /*
    18. Active assignment belongs to a different submission than its linked source assignment.
  */
  select
    'coordinator_source_assignment_belongs_to_different_submission'::text as issue_type,
    'critical'::text as severity,
    s.reference_id::text as reference_id,
    s.workflow_status::text as workflow_status,
    c.id::uuid as assignment_id,
    c.phase::text as phase,
    c.proofreader_type::text as proofreader_type,
    c.status::text as status,
    c.decision::text as decision,
    c.correction_source_phase::text as correction_source_phase,
    c.correction_source_assignment_id::uuid as correction_source_assignment_id,
    p.full_name::text as assigned_to_name,
    p.email::text as assigned_to_email,
    'Coordinator task is linked to a source assignment from a different submission.'::text as details,
    c.created_at::timestamptz as created_at,
    c.updated_at::timestamptz as updated_at
  from active_coordinator_tasks c
  join public.submissions s
    on s.id = c.submission_id
  left join public.profiles p
    on p.id = c.assigned_to
  join public.assignments source_a
    on source_a.id = c.correction_source_assignment_id
  where source_a.submission_id <> c.submission_id
)

select
  issue_type,
  severity,
  reference_id,
  workflow_status,
  assignment_id,
  phase,
  proofreader_type,
  status,
  decision,
  correction_source_phase,
  correction_source_assignment_id,
  assigned_to_name,
  assigned_to_email,
  details,
  created_at,
  updated_at
from issue_rows
order by
  case severity
    when 'critical' then 1
    when 'warning' then 2
    else 3
  end,
  issue_type,
  reference_id,
  created_at desc nulls last;