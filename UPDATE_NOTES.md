# ADEK Frontliners Initiative - Updated Build Notes

This updated project keeps the existing `.env.local` file unchanged.

## Important database steps

Run these new SQL migrations in Supabase SQL Editor, in this order, after your existing migrations:

1. `supabase/migrations/008_workflow_restructure.sql`
2. `supabase/migrations/009_create_adek_hq_user.sql`

The ADEK HQ account created by the migration is:

- Full name: ADEK HQ
- Email/username: adek_hq
- Temporary password: NAE@2026

## Main changes included

- Submitted artworks now go directly to ADEK Evaluation.
- ADEK evaluator home page explains criteria in English and Arabic.
- ADEK task action uses Arabic criteria labels and live decision calculation.
- Proofreader role now supports `proofreader_type`: `general` or `literary`.
- General Proofreaders access all pathways and can return artworks to Coordinators for correction.
- Literary Proofreaders only receive Literary Expressions tasks and can submit Updated Content.
- Literary and General proofreading can happen simultaneously.
- Coordinator work is now correction-only, assigned after General Proofreader returns an artwork.
- Corrected artworks return to the same General Proofreader.
- Reviewers are linked to one or more General Proofreaders from Admin > Users.
- Final review assignment uses the reviewer/proofreader mapping.
- ADEK HQ read-only role can view Submissions and Analytics only.
- Workspace filters were simplified for evaluators, proofreaders, and reviewers.
- Artwork name is now the primary visible title; Reference ID remains metadata.
- Status pills are color-coded.
- Analytics includes Unique Students by Cycle.
- Analytics includes a Download Analytics PDF button using browser print/PDF export.
- User Progress remains live and does not require refreshing materialized views.

## After unzipping

Run:

```powershell
npm.cmd install
npm.cmd run dev
```

Then open:

```text
http://localhost:3000
```

## Follow-up fixes

- The Reviewer / General Proofreader mapping is managed by Admin from Users > Reviewer / General Proofreader Links at the bottom of the Users page. Admin selects the General Proofreader checkboxes for each Reviewer and clicks Save Links.
- The Analytics PDF button now creates and downloads a PDF directly instead of opening the browser print dialog.
- Task Flow has been moved below the Task Action box in all workspaces.
