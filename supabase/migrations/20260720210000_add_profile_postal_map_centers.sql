alter table public.profiles
  add column if not exists postal_latitude double precision,
  add column if not exists postal_longitude double precision,
  add column if not exists postal_geocoded_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_postal_coordinates_pair_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_postal_coordinates_pair_check
      check (
        (postal_latitude is null and postal_longitude is null)
        or (postal_latitude is not null and postal_longitude is not null)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_postal_latitude_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_postal_latitude_check
      check (postal_latitude is null or postal_latitude between -90 and 90);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_postal_longitude_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_postal_longitude_check
      check (postal_longitude is null or postal_longitude between -180 and 180);
  end if;
end
$$;
