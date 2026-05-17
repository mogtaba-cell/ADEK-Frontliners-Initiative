# Performance Optimization Layer

This build includes the approved performance strategy for high-volume, multi-user use.

## Included Optimizations

1. **Server-side filtering and pagination**
   - Submissions, Management, and role workspace pages no longer load all records.
   - Default page size is 50 records.
   - Page size options are 25 / 50 / 100.

2. **Task workspace defaults**
   - Coordinator, Evaluator, Proofreader, and Reviewer pages default to `Not completed`.
   - Users can choose All / Not completed / Completed.
   - Users can filter by pathway, subpathway, region, school type, and search.

3. **Optimized searches**
   - Search runs when the user clicks the filter/start button, not on every keystroke.
   - Search uses indexed fields: reference ID, school name, English title, Arabic title.

4. **Database indexes**
   - Migration `005_performance_optimizations.sql` adds indexes for common filters and workflow queries.
   - It also adds trigram indexes for faster `ilike` search.

5. **Analytics materialized views**
   - Because submissions are expected to start above 2,000 records, the default analytics dashboard uses materialized views.
   - Filtered analytics still use server-side queries but only load the columns required for charting.

6. **Batch import**
   - Import processing uses chunked batch upserts instead of pure row-by-row updates.
   - Existing `referenceId` values are updated, not duplicated.
   - Progress is updated after each chunk.

7. **Batch assignment**
   - Auto assignment checks existing assignments first, then bulk allocates unassigned records.
   - Existing assignments are skipped and never overwritten.
   - Workload is balanced across active users.

8. **Analytics cache refresh**
   - Import, assignment, and workflow completion attempt to refresh analytics materialized views.
   - If the refresh function is not available in local testing, the user action still completes.

## Required SQL Migration

Run the migrations in order. The new performance migration is:

```text
supabase/migrations/005_performance_optimizations.sql
```

This migration should be run after `001`, `002`, `003`, and `004`.

## Recommended page behavior

- Normal user workspace: 50 records per page.
- Admin/Management pages: 50 records per page by default, user-selectable up to 100.
- Exports still run separately and are not limited by page size.
