-- Workflow hardening indexes
-- Run only after workflow_health_report.sql is clean or after known duplicates are repaired.
-- These indexes prevent duplicate active tasks from being inserted later.

create unique index if not exists one_active_assignment_per_submission_phase_non_proofreading
on public.assignments (submission_id, phase)
where phase not in ('proofreading', 'literary_proofreading', 'coordinator_check')
  and status in ('assigned', 'in_progress', 'returned_for_correction', 'sent_for_review');

create unique index if not exists one_active_proofreading_assignment_per_type
on public.assignments (submission_id, phase, proofreader_type)
where phase in ('proofreading', 'literary_proofreading')
  and status in ('assigned', 'in_progress', 'returned_for_correction', 'sent_for_review');

create unique index if not exists one_active_coordinator_task_per_source
on public.assignments (submission_id, correction_source_assignment_id)
where phase = 'coordinator_check'
  and status in ('assigned', 'in_progress')
  and correction_source_assignment_id is not null;

create unique index if not exists one_active_coordinator_task_without_source
on public.assignments (submission_id)
where phase = 'coordinator_check'
  and status in ('assigned', 'in_progress')
  and correction_source_assignment_id is null;
