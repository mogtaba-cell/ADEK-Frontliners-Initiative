-- Literary language selection in the Literary Subcategory workspace.
-- The existing database stores language on public.submissions.literary_language.
-- Valid values are: arabic, english_or_others.

alter table public.submissions
  add column if not exists literary_language text;

alter table public.submissions
  drop constraint if exists submissions_literary_language_check;

alter table public.submissions
  add constraint submissions_literary_language_check
  check (
    literary_language is null
    or literary_language in ('arabic', 'english_or_others')
  );

create index if not exists idx_submissions_literary_language
  on public.submissions (literary_language);
