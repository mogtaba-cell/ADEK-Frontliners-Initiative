create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at before update on profiles for each row execute function set_updated_at();
create trigger submissions_updated_at before update on submissions for each row execute function set_updated_at();
create trigger schools_updated_at before update on schools for each row execute function set_updated_at();
