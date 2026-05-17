alter table profiles enable row level security;
alter table sessions enable row level security;
alter table submissions enable row level security;
alter table schools enable row level security;
alter table students enable row level security;
alter table import_batches enable row level security;
alter table import_errors enable row level security;
alter table assignments enable row level security;
alter table evaluations enable row level security;
alter table management_reviews enable row level security;
alter table proofreading_tasks enable row level security;
alter table final_reviews enable row level security;
alter table comments enable row level security;
alter table audit_logs enable row level security;
alter table export_batches enable row level security;
alter table export_files enable row level security;
alter table system_settings enable row level security;

-- Server-side routes use the Supabase service role key and enforce authorization in application code.
-- RLS is enabled to prevent direct anon/client access by default.
-- Add authenticated Supabase Auth policies here later if switching from app-managed sessions to Supabase Auth sessions.
