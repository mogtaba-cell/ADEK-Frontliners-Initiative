-- Rater rubric score constraint fix
-- Date: 2026-06-22
-- Purpose: The UI and API accept each rubric component as a score from 0 to 100.
-- The old database constraints allowed only weighted maximums 50/35/15, which caused
-- errors such as: submissions_age_appropriateness_score_check.

-- Check current constraints before fixing.
select
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.submissions'::regclass
  and conname in (
    'submissions_artistic_quality_creativity_score_check',
    'submissions_initiative_relation_score_check',
    'submissions_age_appropriateness_score_check',
    'submissions_artistic_rubric_total_score_check'
  )
order by conname;

begin;

alter table public.submissions
  drop constraint if exists submissions_artistic_quality_creativity_score_check;

alter table public.submissions
  add constraint submissions_artistic_quality_creativity_score_check
  check (
    artistic_quality_creativity_score is null
    or artistic_quality_creativity_score between 0 and 100
  );

alter table public.submissions
  drop constraint if exists submissions_initiative_relation_score_check;

alter table public.submissions
  add constraint submissions_initiative_relation_score_check
  check (
    initiative_relation_score is null
    or initiative_relation_score between 0 and 100
  );

alter table public.submissions
  drop constraint if exists submissions_age_appropriateness_score_check;

alter table public.submissions
  add constraint submissions_age_appropriateness_score_check
  check (
    age_appropriateness_score is null
    or age_appropriateness_score between 0 and 100
  );

alter table public.submissions
  drop constraint if exists submissions_artistic_rubric_total_score_check;

alter table public.submissions
  add constraint submissions_artistic_rubric_total_score_check
  check (
    artistic_rubric_total_score is null
    or artistic_rubric_total_score between 0 and 100
  );

commit;

-- Verify after fixing.
select
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.submissions'::regclass
  and conname in (
    'submissions_artistic_quality_creativity_score_check',
    'submissions_initiative_relation_score_check',
    'submissions_age_appropriateness_score_check',
    'submissions_artistic_rubric_total_score_check'
  )
order by conname;

analyze public.submissions;
