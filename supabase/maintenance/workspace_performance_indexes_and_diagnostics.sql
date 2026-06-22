-- Workspace performance diagnostics and indexes.
-- Run the CREATE INDEX statements one at a time in Supabase SQL Editor.
-- Do not wrap CREATE INDEX CONCURRENTLY in BEGIN/COMMIT.

-- 1) See whether any query is currently blocking task completion/loading.
select
  pid,
  now() - query_start as running_for,
  state,
  wait_event_type,
  wait_event,
  left(query, 500) as query_preview
from pg_stat_activity
where datname = current_database()
  and state <> 'idle'
order by query_start nulls last;

-- 2) Check invalid indexes that may be left behind from interrupted CREATE INDEX CONCURRENTLY runs.
select
  ns.nspname as schema_name,
  tbl.relname as table_name,
  idx.relname as index_name,
  i.indisvalid,
  i.indisready
from pg_index i
join pg_class idx on idx.oid = i.indexrelid
join pg_class tbl on tbl.oid = i.indrelid
join pg_namespace ns on ns.oid = tbl.relnamespace
where ns.nspname = 'public'
  and idx.relname like 'idx_%'
order by tbl.relname, idx.relname;

-- 3) Run each CREATE INDEX CONCURRENTLY statement below separately.
create index concurrently if not exists idx_assignments_assigned_phase_status_created
on public.assignments (assigned_to, phase, status, created_at)
include (submission_id, decision, updated_at, completed_at);

create index concurrently if not exists idx_assignments_submission_phase_status_created
on public.assignments (submission_id, phase, status, created_at)
include (assigned_to, decision, updated_at, completed_at);

create index concurrently if not exists idx_assignments_workload_counts
on public.assignments (assigned_to, phase, status)
where status in ('assigned', 'in_progress', 'returned_for_correction', 'sent_for_review', 'completed');

create index concurrently if not exists idx_assignments_active_workload_only
on public.assignments (assigned_to, phase, status)
where status in ('assigned', 'in_progress', 'returned_for_correction', 'sent_for_review');

create index concurrently if not exists idx_assignments_rater_pathway_existing
on public.assignments (submission_id, phase, status)
where phase = 'artistic_ranking' and status <> 'cancelled';

create index concurrently if not exists idx_profiles_role_active_id
on public.profiles (role, is_active, id);

create index concurrently if not exists idx_submissions_reference_id_lookup
on public.submissions (reference_id);

create index concurrently if not exists idx_submissions_ready_for_rater_assignment
on public.submissions (workflow_status, categorization_completed_at, artistic_ranking_completed_at, categorized_pathway)
where workflow_status = 'ready_for_artistic_ranking';

create index concurrently if not exists idx_rater_pathway_assignments_pathway_rater
on public.rater_pathway_assignments (pathway, rater_id);
