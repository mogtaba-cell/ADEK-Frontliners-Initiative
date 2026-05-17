-- Performance optimization layer for ADEK Frontliners Initiative
-- Run after 001-004 migrations.

alter table submissions add column if not exists submission_date_value date;

-- Indexes for fast filtered, paginated pages.
create index if not exists idx_submissions_reference_id on submissions (reference_id);
create index if not exists idx_submissions_workflow_status on submissions (workflow_status);
create index if not exists idx_submissions_registration_status on submissions (registration_status);
create index if not exists idx_submissions_pathway on submissions (art_pathway_name_en);
create index if not exists idx_submissions_subpathway on submissions (art_sub_pathway_name_en);
create index if not exists idx_submissions_region on submissions (school_region);
create index if not exists idx_submissions_school_type on submissions (institution_type);
create index if not exists idx_submissions_school_ref on submissions (institution_ref_number);
create index if not exists idx_submissions_submission_date_value on submissions (submission_date_value);
create index if not exists idx_submissions_updated_at on submissions (updated_at desc);

-- pg_trgm speeds ilike searches. Safe if extension already exists.
create extension if not exists pg_trgm;
create index if not exists idx_submissions_reference_trgm on submissions using gin (reference_id gin_trgm_ops);
create index if not exists idx_submissions_school_name_trgm on submissions using gin (institution_name gin_trgm_ops);
create index if not exists idx_submissions_title_en_trgm on submissions using gin (artwork_title_en gin_trgm_ops);
create index if not exists idx_submissions_title_ar_trgm on submissions using gin (artwork_title_ar gin_trgm_ops);

create index if not exists idx_assignments_assigned_to on assignments (assigned_to);
create index if not exists idx_assignments_phase on assignments (phase);
create index if not exists idx_assignments_status on assignments (status);
create index if not exists idx_assignments_submission_id on assignments (submission_id);
create index if not exists idx_assignments_assignee_phase_status_created on assignments (assigned_to, phase, status, created_at);

create index if not exists idx_evaluations_submission on evaluations (submission_id);
create index if not exists idx_evaluations_evaluator on evaluations (evaluator_id);
create index if not exists idx_evaluations_decision on evaluations (decision);

create index if not exists idx_proofreading_submission on proofreading_tasks (submission_id);
create index if not exists idx_proofreading_proofreader on proofreading_tasks (proofreader_id);
create index if not exists idx_proofreading_status on proofreading_tasks (status);

create index if not exists idx_final_reviews_submission on final_reviews (submission_id);
create index if not exists idx_final_reviews_reviewer on final_reviews (reviewer_id);
create index if not exists idx_final_reviews_status on final_reviews (status);

create index if not exists idx_students_student_key on students (student_key);
create index if not exists idx_students_submission_id on students (submission_id);
create index if not exists idx_students_nationality on students (nationality);
create index if not exists idx_students_gender on students (gender);
create index if not exists idx_students_grade on students (grade);
create index if not exists idx_students_institution_ref on students (institution_ref_number);

-- Filter option view used by workspace pages. This prevents loading all submissions just to populate dropdowns.
create or replace view analytics_filter_options as
select 'pathway'::text as filter_type, art_pathway_name_en::text as value
from submissions
where nullif(art_pathway_name_en, '') is not null
group by art_pathway_name_en

union all

select 'subpathway', art_sub_pathway_name_en
from submissions
where nullif(art_sub_pathway_name_en, '') is not null
group by art_sub_pathway_name_en

union all

select 'school_type', institution_type
from submissions
where nullif(institution_type, '') is not null
group by institution_type

union all

select 'region', school_region
from submissions
where nullif(school_region, '') is not null
group by school_region

union all

select 'registration_status', registration_status
from submissions
where nullif(registration_status, '') is not null
group by registration_status

union all

select 'workflow_status', workflow_status::text
from submissions
group by workflow_status;

-- Materialized analytics views for fast default dashboard loading.
drop materialized view if exists analytics_submission_dimension_mv;
create materialized view analytics_submission_dimension_mv as
select 'pathway'::text as dimension,
       coalesce(nullif(art_pathway_name_en, ''), 'Unspecified')::text as name,
       count(*)::int as value
from submissions
group by 1, 2

union all

select 'subpathway',
       coalesce(nullif(art_sub_pathway_name_en, ''), 'Unspecified'),
       count(*)::int
from submissions
group by 1, 2

union all

select 'school_type',
       coalesce(nullif(institution_type, ''), 'Unspecified'),
       count(*)::int
from submissions
group by 1, 2

union all

select 'region',
       coalesce(nullif(school_region, ''), 'Unspecified'),
       count(*)::int
from submissions
group by 1, 2

union all

select 'registration_status',
       coalesce(nullif(registration_status, ''), 'Unspecified'),
       count(*)::int
from submissions
group by 1, 2

union all

select 'workflow_status',
       workflow_status::text,
       count(*)::int
from submissions
group by 1, 2;

create unique index if not exists ux_analytics_submission_dimension_mv
on analytics_submission_dimension_mv (dimension, name);

-- Unique students by nationality, based on student_key.
drop materialized view if exists analytics_student_nationalities_mv;
create materialized view analytics_student_nationalities_mv as
select coalesce(nullif(nationality, ''), 'Unspecified')::text as nationality,
       count(distinct student_key)::int as unique_students
from students
group by 1;

create unique index if not exists ux_analytics_student_nationalities_mv
on analytics_student_nationalities_mv (nationality);

-- Unique students by gender.
drop materialized view if exists analytics_student_genders_mv;
create materialized view analytics_student_genders_mv as
select coalesce(nullif(gender, ''), 'Unspecified')::text as gender,
       count(distinct student_key)::int as unique_students
from students
group by 1;

create unique index if not exists ux_analytics_student_genders_mv
on analytics_student_genders_mv (gender);

-- Unique students by grade.
drop materialized view if exists analytics_student_grades_mv;
create materialized view analytics_student_grades_mv as
select coalesce(nullif(grade, ''), 'Unspecified')::text as grade,
       count(distinct student_key)::int as unique_students
from students
group by 1;

create unique index if not exists ux_analytics_student_grades_mv
on analytics_student_grades_mv (grade);

-- Unique schools by region/type using institution_ref_number fallback to institution_name.
drop materialized view if exists analytics_unique_schools_mv;
create materialized view analytics_unique_schools_mv as
with unique_schools as (
  select distinct
    coalesce(nullif(institution_ref_number, ''), nullif(institution_name, ''), 'Unknown') as school_key,
    coalesce(nullif(school_region, ''), 'Unspecified') as school_region,
    coalesce(nullif(institution_type, ''), 'Unspecified') as institution_type
  from submissions
)
select 'region'::text as dimension,
       school_region::text as name,
       count(*)::int as value
from unique_schools
group by 1, 2

union all

select 'school_type'::text,
       institution_type::text,
       count(*)::int
from unique_schools
group by 1, 2;

create unique index if not exists ux_analytics_unique_schools_mv
on analytics_unique_schools_mv (dimension, name);

-- User task progress materialized view.
drop materialized view if exists analytics_user_progress_mv;
create materialized view analytics_user_progress_mv as
select
  p.id as user_id,
  p.full_name,
  p.role::text as role,
  count(a.id)::int as assigned,
  count(a.id) filter (where a.status = 'completed')::int as completed,
  count(a.id) filter (where a.status <> 'completed')::int as remaining,
  case
    when count(a.id) = 0 then 0
    else round((count(a.id) filter (where a.status = 'completed'))::numeric * 100 / count(a.id), 2)
  end as completion_rate
from profiles p
left join assignments a on a.assigned_to = p.id
where p.role <> 'admin'
group by p.id, p.full_name, p.role;

create unique index if not exists ux_analytics_user_progress_mv
on analytics_user_progress_mv (user_id);

create or replace function refresh_analytics_materialized_views()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view concurrently analytics_submission_dimension_mv;
  refresh materialized view concurrently analytics_student_nationalities_mv;
  refresh materialized view concurrently analytics_student_genders_mv;
  refresh materialized view concurrently analytics_student_grades_mv;
  refresh materialized view concurrently analytics_unique_schools_mv;
  refresh materialized view concurrently analytics_user_progress_mv;
end;
$$;