# Production-ready customizations added

This build includes the requested workflow customizations for the ADEK Frontliners Initiative system.

## Evaluation rubric

ADEK evaluators now use three Yes/No dropdowns:

1. Cultural Authenticity
2. Artistic Excellence (Quality)
3. Ethical & Public Appropriateness

Automatic decision logic:

- All 3 Yes = Approved
- All 3 No = Disqualified
- A and/or B Yes but C No = Disqualified
- A and/or C Yes but B No = Needs Review
- B and/or C Yes but A No = Needs Review

Approved submissions move to proofreading. Needs Review submissions move to Management. Disqualified submissions are closed as Disqualified.

## Workspaces and filters

Coordinator, Evaluator, Proofreader, and Reviewer users now have workspace pages with:

- pathway filter
- subpathway filter
- region filter
- school type filter
- search by reference, school, or title
- view selector: all / not completed / completed
- task date shown automatically
- start button to apply the selected workspace filters

## Management

Management users can view all submissions and filter specifically to Needs Review cases. They can approve/select for proofreading, disqualify, or return to ADEK Evaluation.

## Analytics

The Analytics page includes:

- UAE vs Non-UAE unique student pie chart
- full nationality table with percentages
- submissions by pathway
- submissions by subpathway
- submissions by school type
- submissions by region
- unique schools by region
- unique schools by school type
- user task progress table showing assigned, completed, remaining, and completion rate
- dashboard filters for date range, pathway, subpathway, school type, region, registration status, and workflow status

## Header KPIs

The top header now shows:

- total submissions
- total evaluated
- total selected
- total proofread
- total reviewed
- total ready

## Folder structure

API routes were checked and standardized. Important paths include:

- app/api/admin/assignments/route.ts
- app/api/admin/users/route.ts
- app/api/import/route.ts
- app/api/workflow/route.ts
- app/api/kpis/route.ts

No incorrectly nested API folders such as `admin \ users` are used.
