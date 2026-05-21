alter table public.assignments
  add column if not exists coordinator_comment text,
  add column if not exists coordinator_waiting_for_response boolean not null default false,
  add column if not exists coordinator_waiting_for_response_at timestamptz;

create index if not exists idx_assignments_coordinator_waiting
on public.assignments (phase, coordinator_waiting_for_response, status);

create index if not exists idx_submissions_institution_name
on public.submissions (institution_name);
