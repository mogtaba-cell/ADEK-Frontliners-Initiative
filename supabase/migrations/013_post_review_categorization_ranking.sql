-- Post-review Categorization and Artistic Ranking workflow additions.
-- Run this migration before deploying the code that uses the new roles/phases/statuses.

alter type app_role add value if not exists 'categorizer';
alter type app_role add value if not exists 'rater';

alter type workflow_phase add value if not exists 'categorization';
alter type workflow_phase add value if not exists 'artistic_ranking';

alter type workflow_status add value if not exists 'ready_for_categorization';
alter type workflow_status add value if not exists 'ready_for_artistic_ranking';

alter table public.submissions
  add column if not exists categorized_pathway text,
  add column if not exists categorization_completed_at timestamptz,
  add column if not exists artistic_ranking text,
  add column if not exists artistic_ranking_completed_at timestamptz;

alter table public.submissions
  drop constraint if exists submissions_categorized_pathway_check;

alter table public.submissions
  add constraint submissions_categorized_pathway_check
  check (
    categorized_pathway is null
    or categorized_pathway in (
      'Visual Expressions',
      'Digital Expressions',
      'Performing Expressions',
      'Others & STEAM Expressions',
      'Literary Expressions'
    )
  );

alter table public.submissions
  drop constraint if exists submissions_artistic_ranking_check;

alter table public.submissions
  add constraint submissions_artistic_ranking_check
  check (
    artistic_ranking is null
    or artistic_ranking in ('Excellent', 'Very Good', 'Good', 'Medium')
  );

create index if not exists idx_submissions_categorized_pathway
  on public.submissions (categorized_pathway);

create index if not exists idx_submissions_artistic_ranking
  on public.submissions (artistic_ranking);
