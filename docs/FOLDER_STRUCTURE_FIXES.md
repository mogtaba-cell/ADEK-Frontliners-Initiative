# Folder Structure Fixes Applied

This package has been cleaned so API routes follow the correct Next.js App Router structure.

Important corrected paths:

- `app/api/admin/users/route.ts`
- `app/api/admin/assignments/route.ts`
- `app/api/import/route.ts`
- `app/admin/AssignmentEngineClient.tsx`
- `app/admin/import/ImportClient.tsx`

The previous bad nesting pattern that caused 404 responses has been removed:

- Do not place assignment routes under `app/api/admin/users/assignments`.
- The auto-assignment API must live at `app/api/admin/assignments/route.ts`.

Validation checks performed:

- No route files are nested under incorrect `admin/users/assignments` paths.
- Static files are available under `public`, not `public_brand` only.
- The sample import template is available at `public/templates/frontliner_import_sample.xlsx`.
- Import and assignment routes return JSON and include progress polling support.
