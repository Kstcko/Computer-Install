-- Computer-Install | v3.2 single-Developer bootstrap
-- Run AFTER the clean schema has completed and exactly one matching Auth user exists.
-- Execute from Supabase SQL Editor (trusted database-admin context), not browser code.
-- This script does not create a password or an Auth account.

begin;

do $$
declare
    v_auth_count integer;
    v_map_count integer;
    v_other_auth_count integer;
begin
    select count(*)
      into v_map_count
      from public.legacy_user_role_map
     where provision_active = true
       and target_role_code = 'developer';

    if v_map_count <> 1 then
        raise exception 'Expected exactly one active Developer mapping; found %.', v_map_count;
    end if;

    select count(*)
      into v_auth_count
      from auth.users au
      join public.legacy_user_role_map lm
        on lower(au.email) = lower(lm.email)
     where lm.provision_active = true
       and lm.target_role_code = 'developer';

    if v_auth_count <> 1 then
        raise exception 'Expected exactly one Supabase Auth user matching the Developer mapping; found %. Create that one account in Supabase Auth first.', v_auth_count;
    end if;

    select count(*)
      into v_other_auth_count
      from auth.users;

    if v_other_auth_count <> 1 then
        raise exception 'Safety stop: expected exactly one Auth user in the project; found %. No accounts were deleted.', v_other_auth_count;
    end if;
end;
$$;

-- Create or promote the one approved Developer profile.
-- The database-admin execution context is required because self-promotion is blocked
-- for ordinary authenticated users by profiles_protect_privileges.
insert into public.profiles (
    id,
    legacy_user_id,
    first_name,
    last_name,
    email,
    phone,
    role_code,
    avatar_style,
    is_active
)
select
    au.id,
    lm.legacy_user_id,
    lm.first_name,
    lm.last_name,
    au.email,
    lm.phone,
    'developer',
    lm.avatar_style,
    true
from auth.users au
join public.legacy_user_role_map lm
  on lower(au.email) = lower(lm.email)
where lm.provision_active = true
  and lm.target_role_code = 'developer'
on conflict (id) do update
set legacy_user_id = excluded.legacy_user_id,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone,
    role_code = 'developer',
    avatar_style = excluded.avatar_style,
    is_active = true;

-- Final assertion: exactly one profile, and it has the Developer role.
do $$
declare
    v_profile_count integer;
    v_developer_count integer;
begin
    select count(*) into v_profile_count from public.profiles;
    select count(*) into v_developer_count
      from public.profiles
     where role_code = 'developer' and is_active = true;

    if v_profile_count <> 1 or v_developer_count <> 1 then
        raise exception 'Bootstrap verification failed: profiles %, active Developers %.',
            v_profile_count, v_developer_count;
    end if;
end;
$$;

commit;
