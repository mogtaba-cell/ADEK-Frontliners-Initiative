-- Rater pathway routing and artistic rubric scoring.
-- Run after 013_post_review_categorization_ranking.sql.

create table if not exists public.rater_pathway_assignments (
  id uuid primary key default gen_random_uuid(),
  rater_id uuid not null references public.profiles(id) on delete cascade,
  pathway text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rater_id, pathway),
  constraint rater_pathway_assignments_pathway_check check (
    pathway in (
      'Visual Expressions',
      'Digital Expressions',
      'Performing Expressions',
      'Others & STEAM Expressions',
      'Literary Expressions'
    )
  )
);

create index if not exists idx_rater_pathway_assignments_rater
  on public.rater_pathway_assignments (rater_id);

create index if not exists idx_rater_pathway_assignments_pathway
  on public.rater_pathway_assignments (pathway);

alter table public.submissions
  add column if not exists artistic_quality_creativity_score integer,
  add column if not exists initiative_relation_score integer,
  add column if not exists age_appropriateness_score integer,
  add column if not exists artistic_rubric_total_score integer,
  add column if not exists artistic_rubric_comment text;

alter table public.submissions
  drop constraint if exists submissions_artistic_ranking_check;

alter table public.submissions
  add constraint submissions_artistic_ranking_check
  check (
    artistic_ranking is null
    or artistic_ranking in (
      'Outstanding',
      'Excellent',
      'Very Good',
      'Average',
      'Weak',
      -- Legacy values kept so old rows do not break the migration.
      'Good',
      'Medium'
    )
  );

alter table public.submissions
  drop constraint if exists submissions_artistic_quality_creativity_score_check;

alter table public.submissions
  add constraint submissions_artistic_quality_creativity_score_check
  check (artistic_quality_creativity_score is null or artistic_quality_creativity_score between 0 and 50);

alter table public.submissions
  drop constraint if exists submissions_initiative_relation_score_check;

alter table public.submissions
  add constraint submissions_initiative_relation_score_check
  check (initiative_relation_score is null or initiative_relation_score between 0 and 35);

alter table public.submissions
  drop constraint if exists submissions_age_appropriateness_score_check;

alter table public.submissions
  add constraint submissions_age_appropriateness_score_check
  check (age_appropriateness_score is null or age_appropriateness_score between 0 and 15);

alter table public.submissions
  drop constraint if exists submissions_artistic_rubric_total_score_check;

alter table public.submissions
  add constraint submissions_artistic_rubric_total_score_check
  check (artistic_rubric_total_score is null or artistic_rubric_total_score between 0 and 100);

create index if not exists idx_submissions_artistic_rubric_total_score
  on public.submissions (artistic_rubric_total_score);
