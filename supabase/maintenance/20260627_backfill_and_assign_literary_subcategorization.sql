-- Optional one-time backfill after running migration 016 and creating/activating
-- at least one user with role = 'literary_subcategorizer'.
-- This moves already-rated Literary Expressions submissions into the new
-- literary subcategory step and assigns them evenly to active literary subcategorizers.

begin;

create temp table _literary_subcategory_targets on commit drop as
select
  s.id,
  s.reference_id,
  row_number() over (order by s.artistic_ranking_completed_at nulls last, s.reference_id) as rn
from public.submissions s
where s.categorized_pathway = 'Literary Expressions'
  and s.artistic_rubric_total_score is not null
  and s.artistic_ranking_completed_at is not null
  and s.literary_subcategory_completed_at is null
  and s.workflow_status::text in ('completed', 'ready_for_literary_subcategorization')
  and not exists (
    select 1
    from public.assignments a
    where a.submission_id = s.id
      and a.phase::text = 'literary_subcategorization'
      and a.status::text in ('assigned', 'in_progress', 'completed')
  );

create temp table _literary_subcategorizers on commit drop as
select
  p.id as user_id,
  p.full_name,
  p.email,
  row_number() over (order by p.full_name, p.email, p.id) as rn,
  count(*) over () as total_users
from public.profiles p
where p.role::text = 'literary_subcategorizer'
  and p.is_active = true;

do $$
begin
  if exists (select 1 from _literary_subcategory_targets)
     and not exists (select 1 from _literary_subcategorizers) then
    raise exception 'Create and activate at least one literary_subcategorizer user before running this backfill.';
  end if;
end $$;

create table if not exists public.literary_subcategory_backfill_backup_20260627 (
  backup_created_at timestamptz,
  submission_id uuid,
  reference_id text,
  old_workflow_status text,
  old_completed_at timestamptz,
  old_literary_subcategory text,
  old_literary_subcategory_completed_at timestamptz,
  assigned_to uuid,
  assigned_to_email text,
  submission_before jsonb
);

insert into public.literary_subcategory_backfill_backup_20260627 (
  backup_created_at,
  submission_id,
  reference_id,
  old_workflow_status,
  old_completed_at,
  old_literary_subcategory,
  old_literary_subcategory_completed_at,
  assigned_to,
  assigned_to_email,
  submission_before
)
select
  now(),
  s.id,
  s.reference_id,
  s.workflow_status::text,
  s.completed_at,
  s.literary_subcategory,
  s.literary_subcategory_completed_at,
  u.user_id,
  u.email,
  to_jsonb(s)
from public.submissions s
join _literary_subcategory_targets t on t.id = s.id
left join _literary_subcategorizers u
  on u.rn = ((t.rn - 1) % nullif(u.total_users, 0)) + 1;

update public.submissions s
set
  workflow_status = 'ready_for_literary_subcategorization',
  completed_at = null,
  updated_at = now()
from _literary_subcategory_targets t
where s.id = t.id;

insert into public.assignments (
  submission_id,
  phase,
  status,
  assigned_to,
  created_at,
  updated_at
)
select
  t.id,
  'literary_subcategorization',
  'assigned',
  u.user_id,
  now(),
  now()
from _literary_subcategory_targets t
join _literary_subcategorizers u
  on u.rn = ((t.rn - 1) % nullif(u.total_users, 0)) + 1;

commit;

-- Verify distribution
select
  p.full_name,
  p.email,
  count(a.id) filter (where a.status::text in ('assigned', 'in_progress')) as remaining,
  count(a.id) filter (where a.status::text = 'completed') as completed
from public.profiles p
left join public.assignments a
  on a.assigned_to = p.id
  and a.phase::text = 'literary_subcategorization'
where p.role::text = 'literary_subcategorizer'
group by p.full_name, p.email
order by remaining desc, completed desc, p.full_name;
