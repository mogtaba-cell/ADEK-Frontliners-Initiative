-- Workflow / assignment consistency update.
-- Run this before deploying the updated code.

-- New assignment states used to pause a task while another level acts.
alter type assignment_status add value if not exists 'returned_for_correction';
alter type assignment_status add value if not exists 'sent_for_review';

-- Columns used by the updated workflow. Safe to run repeatedly.
alter table public.submissions
  add column if not exists general_proofreading_completed_at timestamptz,
  add column if not exists literary_proofreading_completed_at timestamptz,
  add column if not exists literary_proofreader_comment text,
  add column if not exists literary_publication_suitable boolean,
  add column if not exists literary_updated_content text,
  add column if not exists literary_management_approved_at timestamptz,
  add column if not exists evaluator_comment text,
  add column if not exists evaluator_file_quality_clear boolean,
  add column if not exists cultural_authenticity boolean,
  add column if not exists artistic_excellence boolean,
  add column if not exists ethical_public_appropriateness boolean,
  add column if not exists evaluation_decision text,
  add column if not exists management_decision text,
  add column if not exists reviewer_decision text,
  add column if not exists disqualification_reason text,
  add column if not exists coordinator_disqualification_reason text,
  add column if not exists completed_at timestamptz;

alter table public.assignments
  add column if not exists updated_at timestamptz default now(),
  add column if not exists requested_by_user_id uuid references public.profiles(id),
  add column if not exists return_to_user_id uuid references public.profiles(id),
  add column if not exists correction_reason text,
  add column if not exists correction_notes text,
  add column if not exists correction_source_phase text,
  add column if not exists correction_source_assignment_id uuid,
  add column if not exists proofreader_type text,
  add column if not exists decision text;

comment on column public.submissions.literary_proofreader_comment is
'Comment entered by Literary Proofreader, visible to Coordinator when sent for correction.';

-- The old unique index only protected assigned/in_progress. Recreate it so paused states
-- also block duplicate same-phase work. Use status::text to avoid migration issues with
-- enum values that were added earlier in this file.
drop index if exists public.one_active_assignment_per_phase;
drop index if exists public.ux_assignments_one_active_per_submission_phase;

create unique index if not exists ux_assignments_one_open_per_submission_phase
on public.assignments (submission_id, phase)
where status::text in ('assigned', 'in_progress', 'returned_for_correction', 'sent_for_review');

create index if not exists idx_assignments_phase_status_submission
on public.assignments (phase, status, submission_id);

create index if not exists idx_assignments_requested_return
on public.assignments (requested_by_user_id, return_to_user_id);

-- View used by Admin > Literary Language. It only shows approved Literary Expressions
-- artworks that are not in correction, active management review, or disqualified.
drop view if exists public.admin_literary_language_eligible;

create view public.admin_literary_language_eligible as
select s.*
from public.submissions s
where (
    s.art_pathway_name_en ilike '%Literary Expressions%'
    or s.art_pathway_name_ar ilike '%التعبيرات الأدبية%'
    or s.art_pathway_name_ar ilike '%التعبيرات الادبية%'
  )
  and s.evaluation_decision = 'approved'
  and coalesce(s.workflow_status::text, '') <> 'disqualified'
  and coalesce(s.management_decision, '') <> 'disqualified'
  and not exists (
    select 1
    from public.assignments c
    where c.submission_id = s.id
      and c.phase = 'coordinator_check'
      and c.status::text in ('assigned', 'in_progress')
  )
  and not exists (
    select 1
    from public.assignments m
    where m.submission_id = s.id
      and m.phase = 'management_review'
      and m.status::text in ('assigned', 'in_progress')
  )
  and (
    not exists (
      select 1
      from public.assignments m_any
      where m_any.submission_id = s.id
        and m_any.phase = 'management_review'
    )
    or s.management_decision = 'approved'
  );
