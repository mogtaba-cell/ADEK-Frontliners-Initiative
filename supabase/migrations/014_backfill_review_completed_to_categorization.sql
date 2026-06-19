-- Backfill already reviewed artworks into the new post-review workflow.
-- Reviewer-completed submissions were previously marked completed; now they wait
-- for Categorization, then Artistic Ranking, then become truly completed.

update public.submissions s
set
  workflow_status = 'ready_for_categorization',
  completed_at = null,
  updated_at = now()
where s.workflow_status = 'completed'
  and s.reviewer_decision = 'completed'
  and s.categorization_completed_at is null
  and s.artistic_ranking_completed_at is null
  and coalesce(s.evaluation_decision, '') <> 'disqualified'
  and coalesce(s.management_decision, '') <> 'disqualified'
  and coalesce(s.coordinator_disqualification_reason, '') = '';


create index if not exists idx_assignments_categorization_active
  on public.assignments (submission_id, assigned_to, status)
  where phase = 'categorization';

create index if not exists idx_assignments_artistic_ranking_active
  on public.assignments (submission_id, assigned_to, status)
  where phase = 'artistic_ranking';
