-- Grade normalization and analytics refresh fixes.

create or replace function normalize_student_grade(input_value text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text;
  match_result text[];
begin
  if input_value is null or btrim(input_value) = '' then
    return null;
  end if;

  cleaned := regexp_replace(btrim(input_value), '\s+', ' ', 'g');

  match_result := regexp_match(cleaned, 'grade\s*([0-9]{1,2})', 'i');

  if match_result is not null then
    return 'Grade ' || (match_result[1])::int;
  end if;

  match_result := regexp_match(cleaned, '^g\s*([0-9]{1,2})$', 'i');

  if match_result is not null then
    return 'Grade ' || (match_result[1])::int;
  end if;

  return cleaned;
end;
$$;

update students
set grade = normalize_student_grade(grade)
where grade is not null;

drop materialized view if exists analytics_student_grades_mv;

create materialized view analytics_student_grades_mv as
select
  coalesce(normalize_student_grade(grade), 'Unspecified')::text as grade,
  count(distinct student_key)::int as unique_students
from students
group by 1;

create unique index if not exists ux_analytics_student_grades_mv
on analytics_student_grades_mv (grade);

create index if not exists idx_students_normalized_grade
on students (normalize_student_grade(grade));

create or replace function refresh_analytics_materialized_views()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view concurrently analytics_submission_dimension_mv;
  refresh materialized view concurrently analytics_student_nationalities_mv;
  refresh materialized view concurrently analytics_student_genders_mv;
  refresh materialized view concurrently analytics_student_grades_mv;
  refresh materialized view concurrently analytics_unique_schools_mv;
  refresh materialized view concurrently analytics_user_progress_mv;
end;
$$;