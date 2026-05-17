# Production Checklist

## Database
- [ ] Migrations applied in order.
- [ ] `submissions.reference_id` unique constraint tested.
- [ ] `one_active_assignment_per_phase` unique index tested.
- [ ] RLS enabled.
- [ ] Service role key only used in server routes.

## Auth
- [ ] First admin created.
- [ ] Default bootstrap password changed.
- [ ] Inactive users cannot log in.
- [ ] Each role sees only the correct queues.

## Imports
- [ ] Import sample Excel.
- [ ] Reimport same file and confirm updates, not duplicates.
- [ ] Confirm import error rows appear.
- [ ] Confirm schools/students parsed.

## Exports
- [ ] Google service account added to Shared Drive folder.
- [ ] Manual export succeeds.
- [ ] Daily cron export succeeds.
- [ ] Export folders are dated and categorized.

## Deployment
- [ ] Vercel env vars configured.
- [ ] Supabase project URL/key configured.
- [ ] CRON_SECRET configured.
- [ ] GitHub CI passes.
