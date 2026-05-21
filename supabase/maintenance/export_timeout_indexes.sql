-- Optional export performance indexes.
-- These are safe to run more than once and help the export queries avoid slow scans/sorts.
create index if not exists idx_assignments_created_at_export
  on public.assignments (created_at);

create index if not exists idx_assignments_submission_id_export
  on public.assignments (submission_id);

create index if not exists idx_evaluations_id_export
  on public.evaluations (id);

create index if not exists idx_evaluations_submission_id_export
  on public.evaluations (submission_id);

create index if not exists idx_audit_logs_created_at_export
  on public.audit_logs (created_at);

create index if not exists idx_comments_created_at_export
  on public.comments (created_at);
