-- Split literary proofreaders into Arabic and English/Other proofreader types.
-- Run after 008/010 on existing Supabase projects.

alter table public.profiles
  drop constraint if exists profiles_proofreader_type_check;

update public.profiles
set proofreader_type = 'literary_arabic', updated_at = now()
where role = 'proofreader'
  and proofreader_type = 'literary';

alter table public.profiles
  add constraint profiles_proofreader_type_check
  check (
    proofreader_type is null
    or proofreader_type in (
      'general',
      'literary_arabic',
      'literary_english_or_others'
    )
  );

alter table public.assignments
  drop constraint if exists assignments_proofreader_type_check;

update public.assignments
set proofreader_type = 'literary_arabic'
where proofreader_type = 'literary';

alter table public.assignments
  add constraint assignments_proofreader_type_check
  check (
    proofreader_type is null
    or proofreader_type in (
      'general',
      'literary_arabic',
      'literary_english_or_others'
    )
  );

create index if not exists idx_profiles_role_proofreader_type
on public.profiles (role, proofreader_type, is_active);
