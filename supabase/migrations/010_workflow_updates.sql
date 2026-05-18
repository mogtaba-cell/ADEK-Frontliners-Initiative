-- Run this once in Supabase SQL Editor before deploying the code.

alter table public.submissions
add column if not exists evaluator_comment text;

alter table public.submissions
add column if not exists evaluator_file_quality_clear boolean;

alter table public.submissions
add column if not exists cultural_authenticity boolean;

alter table public.submissions
add column if not exists artistic_excellence boolean;

alter table public.submissions
add column if not exists ethical_public_appropriateness boolean;

alter table public.submissions
add column if not exists evaluation_decision text;

alter table public.submissions
add column if not exists disqualification_reason text;

alter table public.submissions
add column if not exists coordinator_disqualification_reason text;

alter table public.submissions
add column if not exists management_decision text;

alter table public.submissions
add column if not exists reviewer_decision text;

alter table public.submissions
add column if not exists completed_at timestamptz;

alter table public.submissions
add column if not exists literary_publication_suitable boolean;

alter table public.submissions
add column if not exists literary_updated_content text;

alter table public.submissions
add column if not exists literary_management_approved_at timestamptz;

alter table public.assignments
add column if not exists correction_source_phase text;

alter table public.assignments
add column if not exists correction_source_assignment_id uuid;

comment on column public.submissions.evaluator_comment is
'Comment entered by ADEK Evaluator during evaluation.';

comment on column public.submissions.coordinator_disqualification_reason is
'Coordinator disqualification reason: no_school_response or incomplete_faulty_after_correction.';
