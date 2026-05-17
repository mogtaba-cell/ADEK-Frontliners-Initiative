create extension if not exists pgcrypto;

create type app_role as enum ('admin','coordinator','evaluator','management','proofreader','reviewer');
create type workflow_status as enum ('imported','coordinator_pending','returned_for_correction','ready_for_adek','adek_in_progress','approved','needs_management_review','disqualified','selected_for_proofreading','proofreading_in_progress','proofreading_done','final_review_in_progress','completed');
create type workflow_phase as enum ('coordinator_check','adek_evaluation','management_review','proofreading','final_review');
create type assignment_status as enum ('assigned','in_progress','completed','reassigned','cancelled');
create type decision_status as enum ('pending','approved','needs_review','disqualified');

create table profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text unique,
  full_name text not null,
  password_hash text not null,
  role app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  imported_by uuid references profiles(id),
  status text not null default 'processing',
  rows_inserted int not null default 0,
  rows_updated int not null default 0,
  rows_skipped int not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  reference_id text not null unique,
  registration_id text,
  registration_status text,
  submission_date text,
  art_pathway_name_en text,
  art_pathway_name_ar text,
  art_sub_pathway_name_en text,
  institution_type text,
  school_region text,
  institution_ref_number text,
  institution_name text,
  art_link text,
  artwork_title_en text,
  artwork_title_ar text,
  description_en text,
  description_ar text,
  participating_students_esis_numbers text,
  participating_students_names text,
  participating_students_grades text,
  participating_students_genders text,
  participating_students_nationalities text,
  raw_data jsonb not null default '{}'::jsonb,
  workflow_status workflow_status not null default 'imported',
  last_import_batch_id uuid references import_batches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table schools (
  id uuid primary key default gen_random_uuid(),
  institution_ref_number text not null unique,
  institution_name text,
  school_region text,
  institution_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table students (
  id uuid primary key default gen_random_uuid(),
  student_key text not null,
  submission_id uuid not null references submissions(id) on delete cascade,
  esis_number text,
  full_name text,
  grade text,
  gender text,
  nationality text,
  institution_ref_number text,
  created_at timestamptz not null default now(),
  unique(student_key, submission_id)
);

create table import_errors (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches(id) on delete cascade,
  row_number int,
  reference_id text,
  error_type text not null,
  error_message text not null,
  created_at timestamptz not null default now()
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  phase workflow_phase not null,
  assigned_to uuid not null references profiles(id),
  assigned_by uuid references profiles(id),
  status assignment_status not null default 'assigned',
  locked_by uuid references profiles(id),
  lock_expires_at timestamptz,
  reassignment_reason text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index one_active_assignment_per_phase on assignments(submission_id, phase) where status in ('assigned','in_progress');
create index idx_assignments_user_phase_status on assignments(assigned_to, phase, status);

create table evaluations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  evaluator_id uuid not null references profiles(id),
  cultural_authenticity text not null,
  artistic_excellence text not null,
  ethical_public_appropriateness text not null,
  decision decision_status not null,
  comments text,
  created_at timestamptz not null default now(),
  unique(submission_id, evaluator_id)
);

create table management_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade unique,
  reviewer_id uuid not null references profiles(id),
  decision decision_status not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table proofreading_tasks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade unique,
  proofreader_id uuid references profiles(id),
  status text not null default 'not_started',
  arabic_title_reviewed boolean not null default false,
  english_title_reviewed boolean not null default false,
  arabic_description_reviewed boolean not null default false,
  english_description_reviewed boolean not null default false,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table final_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade unique,
  reviewer_id uuid references profiles(id),
  status text not null default 'pending',
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  author_id uuid not null references profiles(id),
  phase workflow_phase,
  comment_text text not null,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table export_batches (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references profiles(id),
  mode text not null,
  status text not null default 'processing',
  destination_folder_id text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table export_files (
  id uuid primary key default gen_random_uuid(),
  export_batch_id uuid not null references export_batches(id) on delete cascade,
  data_type text not null,
  file_name text not null,
  google_file_id text,
  google_file_url text,
  created_at timestamptz not null default now()
);

create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
