-- Check where literary language is stored and how many Literary Expressions records are missing it.

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'submissions'
  and column_name = 'literary_language';

select
  literary_language,
  count(*) as submissions_count
from public.submissions
where categorized_pathway = 'Literary Expressions'
group by literary_language
order by literary_language nulls first;

select
  count(*) as literary_expressions_missing_language
from public.submissions
where categorized_pathway = 'Literary Expressions'
  and (literary_language is null or trim(literary_language) = '');

select
  reference_id,
  categorized_pathway,
  raw_data ->> 'ArtPathwayNameEn' as original_raw_pathway,
  literary_language,
  literary_subcategory,
  workflow_status
from public.submissions
where categorized_pathway = 'Literary Expressions'
  and (literary_language is null or trim(literary_language) = '')
order by reference_id
limit 100;
