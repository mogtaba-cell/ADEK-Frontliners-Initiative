-- Literary subcategory workflow step after artistic grading.
-- Run this migration before deploying the code that uses the new role/phase/status.

alter type app_role add value if not exists 'literary_subcategorizer';

alter type workflow_phase add value if not exists 'literary_subcategorization';

alter type workflow_status add value if not exists 'ready_for_literary_subcategorization';

alter table public.submissions
  add column if not exists literary_subcategory text,
  add column if not exists literary_subcategory_completed_at timestamptz;

alter table public.submissions
  drop constraint if exists submissions_literary_subcategory_check;

alter table public.submissions
  add constraint submissions_literary_subcategory_check
  check (
    literary_subcategory is null
    or literary_subcategory in (
      'Letters & Messages',
      'Poetry (Written or Recited)',
      'Speech',
      'Short Story',
      'Other Creative Writing'
    )
  );

create index if not exists idx_submissions_literary_subcategory
  on public.submissions (literary_subcategory);

create index if not exists idx_submissions_literary_subcategory_completed_at
  on public.submissions (literary_subcategory_completed_at);

create index if not exists idx_assignments_literary_subcategorization_queue
  on public.assignments (phase, assigned_to, status, created_at);