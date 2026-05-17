-- Fix missing submission fields and normalize nationalities for analytics.

alter table submissions add column if not exists art_pathway_name_ar text;
alter table submissions add column if not exists art_sub_pathway_name_ar text;
alter table submissions add column if not exists submission_date_value date;

create or replace function normalize_student_nationality(input_value text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text;
begin
  if input_value is null or btrim(input_value) = '' then
    return 'Unspecified';
  end if;

  cleaned := lower(btrim(input_value));
  cleaned := regexp_replace(cleaned, '\s+', ' ', 'g');

  if cleaned in (
    'uae',
    'u.a.e',
    'u.a.e.',
    'united arab emirates',
    'emirati',
    'emirates',
    'الإمارات',
    'الامارات',
    'الإمارات العربية المتحدة',
    'الامارات العربية المتحدة',
    'إماراتي',
    'اماراتي'
  ) then
    return 'UAE';
  end if;

  if cleaned in ('usa', 'u.s.a', 'u.s.a.', 'united states', 'united states of america', 'america') then
    return 'USA';
  end if;

  if cleaned in ('uk', 'u.k.', 'britain', 'united kingdom', 'great britain') then
    return 'United Kingdom';
  end if;

  return initcap(btrim(input_value));
end;
$$;

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
set
  nationality = normalize_student_nationality(nationality),
  grade = normalize_student_grade(grade)
where nationality is not null
   or grade is not null;

drop materialized view if exists analytics_student_nationalities_mv;

create materialized view analytics_student_nationalities_mv as
select
  normalize_student_nationality(nationality)::text as nationality,
  count(distinct student_key)::int as unique_students
from students
group by 1;

create unique index if not exists ux_analytics_student_nationalities_mv
on analytics_student_nationalities_mv (nationality);

drop materialized view if exists analytics_student_grades_mv;

create materialized view analytics_student_grades_mv as
select
  coalesce(normalize_student_grade(grade), 'Unspecified')::text as grade,
  count(distinct student_key)::int as unique_students
from students
group by 1;

create unique index if not exists ux_analytics_student_grades_mv
on analytics_student_grades_mv (grade);

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