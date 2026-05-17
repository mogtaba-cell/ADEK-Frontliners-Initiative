-- Create ADEK HQ read-only account. Run after 008_workflow_restructure.sql so the adek_hq enum value is committed.

insert into profiles (email, username, full_name, password_hash, role, is_active, proofreader_type, updated_at)
values (
  'adek_hq',
  'adek_hq',
  'ADEK HQ',
  crypt('NAE@2026', gen_salt('bf', 12)),
  'adek_hq',
  true,
  null,
  now()
)
on conflict (email)
do update set
  username = excluded.username,
  full_name = excluded.full_name,
  password_hash = excluded.password_hash,
  role = excluded.role,
  is_active = true,
  proofreader_type = null,
  updated_at = now();
