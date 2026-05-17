# ADEK Frontliners Initiative — Production Build

A production-ready custom evaluation system for the ADEK Frontliners Initiative using Next.js, Supabase, Vercel, GitHub, and Google Shared Drive exports.

## Core production guarantees

- `reference_id` is the unique artwork key.
- Reimporting a submission with an existing `reference_id` updates the existing artwork instead of duplicating it.
- One active assignment per artwork per phase.
- Role-based access for Admin, Coordinator, ADEK Evaluator, Management, Proofreader, and Reviewer.
- Assignment queues prevent duplicate work and overwriting.
- All important actions are saved to audit logs.
- Comments are stage-based and attached to each artwork.
- Daily automatic export plus manual Admin export to the project Google Shared Drive folder.
- Exported files are organized by date and data category.
- Supabase database remains the live source of truth; Google Drive exports are backup, archive, reporting, and handover outputs.

## Stack

- Next.js App Router
- Supabase Postgres
- Supabase Auth-compatible username/password flow using app-managed profiles
- Supabase Row Level Security policies
- Vercel deployment and Cron
- Google Drive API for Shared Drive exports
- ExcelJS/XLSX for import/export

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create a Supabase project.

3. Run SQL in this order inside Supabase SQL Editor:

```text
supabase/migrations/001_init.sql
supabase/migrations/002_rls.sql
supabase/migrations/003_functions.sql
```

4. Copy environment variables:

```bash
cp .env.example .env.local
```

5. Fill `.env.local` values.

6. Create the first admin user:

```bash
npm run create-admin
```

7. Start locally:

```bash
npm run dev
```

Open http://localhost:3000

## Production deployment

1. Push this folder to a GitHub repository.
2. Import the repository into Vercel.
3. Add all environment variables in Vercel Project Settings.
4. In Supabase, run the SQL migrations.
5. Create first admin using the script locally or a temporary secure admin route disabled after use.
6. Verify `/api/cron/daily-export` is protected by `CRON_SECRET`.
7. Add Google service account access to the company Shared Drive project folder.

## User roles

- `admin`: imports/exports data, manages users, assignments, audit logs, all records.
- `coordinator`: checks submitted artworks assigned to them.
- `evaluator`: grades submitted artworks assigned to them.
- `management`: reviews Needs Review cases.
- `proofreader`: proofreads selected/approved artworks assigned to them.
- `reviewer`: final reviews proofread artworks assigned to them.

## Google Shared Drive export structure

```text
ADEK Frontliners Initiative Exports
└── YYYY-MM-DD
    ├── 01_uploaded_data
    ├── 02_import_logs
    ├── 03_submissions_master
    ├── 04_assignments
    ├── 05_coordinator_checks
    ├── 06_evaluations
    ├── 07_management_review
    ├── 08_proofreading
    ├── 09_final_review
    ├── 10_comments
    ├── 11_audit_logs
    └── 12_analytics
```

## Security checklist before launch

- Rotate all service keys.
- Use long random `CRON_SECRET` and `EXPORT_ENCRYPTION_SECRET`.
- Confirm Supabase RLS is enabled on all application tables.
- Confirm Vercel environment variables are set for Production only when appropriate.
- Confirm only server routes use `SUPABASE_SERVICE_ROLE_KEY`.
- Confirm Google service account has access only to the project Shared Drive folder.
- Test imports with duplicate `reference_id` values.
- Test one active assignment per phase.
- Test each role cannot access another role's queue.
- Test daily export and manual export.
