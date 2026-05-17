-- Progress tracking for import batches
alter table import_batches
add column if not exists rows_total int not null default 0,
add column if not exists rows_processed int not null default 0,
add column if not exists current_step text,
add column if not exists started_at timestamptz;

-- Assignment progress batches
create table if not exists assignment_batches (
  id uuid primary key default gen_random_uuid(),
  phase text not null,
  status text not null default 'queued',
  current_step text,
  eligible_count int not null default 0,
  processed_count int not null default 0,
  assigned_count int not null default 0,
  skipped_count int not null default 0,
  error_count int not null default 0,
  error_message text,
  started_by uuid references profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists assignment_batch_errors (
  id uuid primary key default gen_random_uuid(),
  assignment_batch_id uuid references assignment_batches(id) on delete cascade,
  submission_id uuid,
  reference_id text,
  error_message text,
  created_at timestamptz not null default now()
);

-- Protect against duplicate active assignments for the same artwork and phase
create unique index if not exists ux_assignments_one_active_per_submission_phase
on assignments (submission_id, phase)
where status in ('assigned', 'in_progress');
