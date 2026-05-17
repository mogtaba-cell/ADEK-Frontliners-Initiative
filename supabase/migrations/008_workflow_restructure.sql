-- Workflow restructure for ADEK direct evaluation, proofreader types, reviewer links, ADEK HQ, and task tracking.

alter type app_role add value if not exists 'adek_hq';
alter type workflow_phase add value if not exists 'literary_proofreading';

alter table profiles add column if not exists proofreader_type text;

alter table profiles
  drop constraint if exists profiles_proofreader_type_check;

alter table profiles
  add constraint profiles_proofreader_type_check
  check (proofreader_type is null or proofreader_type in ('general', 'literary'));

update profiles
set proofreader_type = 'general'
where role = 'proofreader' and proofreader_type is null;

alter table submissions add column if not exists art_sub_pathway_name_ar text;
alter table submissions add column if not exists submission_date_value date;
alter table submissions add column if not exists literary_updated_content text;
alter table submissions add column if not exists general_proofreading_completed_at timestamptz;
alter table submissions add column if not exists literary_proofreading_completed_at timestamptz;
alter table submissions add column if not exists literary_management_approved_at timestamptz;

alter table assignments add column if not exists updated_at timestamptz default now();
alter table assignments add column if not exists requested_by_user_id uuid references profiles(id);
alter table assignments add column if not exists return_to_user_id uuid references profiles(id);
alter table assignments add column if not exists correction_reason text;
alter table assignments add column if not exists correction_notes text;
alter table assignments add column if not exists proofreader_type text;

alter table assignments
  drop constraint if exists assignments_proofreader_type_check;

alter table assignments
  add constraint assignments_proofreader_type_check
  check (proofreader_type is null or proofreader_type in ('general', 'literary'));

alter table evaluations add column if not exists updated_at timestamptz default now();

create table if not exists reviewer_proofreader_links (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references profiles(id) on delete cascade,
  proofreader_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (reviewer_id, proofreader_id)
);

create index if not exists idx_reviewer_proofreader_links_reviewer on reviewer_proofreader_links (reviewer_id);
create index if not exists idx_reviewer_proofreader_links_proofreader on reviewer_proofreader_links (proofreader_id);
create index if not exists idx_assignments_requested_by on assignments (requested_by_user_id);
create index if not exists idx_assignments_return_to on assignments (return_to_user_id);
create index if not exists idx_profiles_role_proofreader_type on profiles (role, proofreader_type, is_active);

-- New workflow starts with ADEK evaluation directly.
update submissions
set workflow_status = 'ready_for_adek', updated_at = now()
where workflow_status in ('imported', 'coordinator_pending')
  and registration_status = 'Submitted';
