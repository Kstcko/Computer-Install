-- ============================================================================
-- Computer-Install | Supabase PostgreSQL schema v3.2 CLEAN
-- Status: READY FOR REVIEW / ONE-TIME INITIAL INSTALL (not yet executed)
--
-- v3.2 CLEAN updates:
--   * Developer receives the same 18 permissions as Admin.
--   * Four application roles only: admin, developer, technician, intern.
--   * Departments seeded cleanly: ช่าง, นักศึกษาฝึกงาน and Store only.
--   * Explicit permission matrix for all 18 permission codes.
--   * Only the single Developer account from the old data is retained as a provisioning map.
--   * All other old user records are omitted; no jobs or operational records are imported.
--   * Legacy passwords are NOT imported; Supabase Auth must provision accounts.
--   * One job_number -> many install_items; department/date/requester are per item.
--   * Owner may be a profile or a manually entered name.
--   * One Install Report per machine item; private Storage photo bucket.
--   * Fixes assignment checks on INSERT and UPDATE, creator spoofing, column grants,
--     report-photo validation, and Storage-aware trash purge.
--
-- SAFETY:
--   * Run only once in the intended NEW Supabase project after reviewing this file.
--   * This script creates an empty application schema plus one Developer provisioning
--     record. It does not create Auth users or import any old jobs/users/operational rows.
--   * Do not paste PHP password hashes into Supabase Auth or profiles.
--   * Never expose the service_role key in browser code.
-- ============================================================================

begin;

-- Stop rather than silently mixing this initial-install script with an existing
-- or partially deployed application schema. This script does not delete existing
-- auth.users rows; inspect the Auth user list before using a non-empty project.
do $$
begin
    if to_regclass('public.roles') is not null
       or to_regclass('public.profiles') is not null
       or to_regclass('public.installs') is not null then
        raise exception 'Computer-Install schema already exists. Do not rerun v3.2; use a reviewed migration.';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Reference data: roles, departments, permissions
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
    role_code text primary key,
    role_name text not null unique,
    description text,
    created_at timestamptz not null default now(),
    constraint roles_code_format check (role_code ~ '^[a-z][a-z0-9_]*$')
);

insert into public.roles (role_code, role_name, description) values
    ('admin', 'Admin', 'ผู้ดูแลระบบและจัดการสิทธิ์ทั้งหมด'),
    ('developer', 'Developer', 'มีสิทธิ์ครบทุกฟังก์ชันเทียบเท่า Admin'),
    ('technician', 'ช่าง', 'รับผิดชอบงานติดตั้ง เปลี่ยนสถานะ และส่ง Install Report'),
    ('intern', 'นักศึกษาฝึกงาน', 'ดูข้อมูลงานและประกาศได้เท่านั้น');

create table if not exists public.departments (
    id uuid primary key default gen_random_uuid(),
    legacy_department_id bigint unique,
    department_code text unique,
    department_name text not null unique,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

-- Clean starting departments only. Old personal/QA and discontinued
-- department rows are intentionally not carried over because no jobs are migrated.
-- Store is a department, not an application role.
insert into public.departments
    (legacy_department_id, department_code, department_name, is_active)
values
    (null, 'technician', 'ช่าง', true),
    (null, 'intern', 'นักศึกษาฝึกงาน', true),
    (null, 'store', 'Store', true);

-- Provisioning map for exactly ONE account: the existing Developer record (Dev 0).
-- This is NOT a Supabase Auth account. Create that one account via Supabase Auth,
-- then run the separate Developer Bootstrap SQL to give it the Developer role.
-- All other seven old user records are intentionally omitted. Never import PHP hashes.
create table if not exists public.legacy_user_role_map (
    legacy_user_id text primary key,
    first_name text not null,
    last_name text not null,
    email text not null unique,
    phone text,
    avatar_style text,
    legacy_created_at timestamp without time zone,
    legacy_role_code text not null,
    target_role_code text not null references public.roles(role_code) on update cascade on delete restrict,
    provision_active boolean not null default false,
    is_test_account boolean not null default false,
    mapping_reason text not null,
    created_at timestamptz not null default now(),
    constraint legacy_user_role_map_id_not_blank check (length(trim(legacy_user_id)) > 0),
    constraint legacy_user_role_map_email_format check (position('@' in email) > 1),
    constraint legacy_user_test_accounts_inactive check (not is_test_account or not provision_active)
);

insert into public.legacy_user_role_map
    (legacy_user_id, first_name, last_name, email, phone, avatar_style, legacy_created_at,
     legacy_role_code, target_role_code, provision_active, is_test_account, mapping_reason)
values
    ('USER-ea279022560b2650', 'Dev', '0', 'nphrhmphmr@gmail.com',
     null, 'frame', '2026-10-09 09:36:06', 'developer', 'developer', true, false,
     'เก็บไว้เป็นบัญชี Developer เพียงบัญชีเดียว; ต้องสร้างรหัสผ่านใหม่ผ่าน Supabase Auth');

create table if not exists public.role_permissions (
    role_code text not null references public.roles(role_code) on update cascade on delete cascade,
    permission_code text not null,
    is_allowed boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (role_code, permission_code),
    constraint role_permissions_code_not_blank check (length(trim(permission_code)) > 0)
);

-- Complete explicit matrix: 4 roles x 18 permissions. Developer has all 18 enabled.
-- Admin and Developer: all 18 permissions enabled (equivalent application privileges).
-- Technician: create/view jobs, change status, submit Install Reports, view notices/updates.
-- Intern: read-only access to jobs, notices and published updates.
insert into public.role_permissions (role_code, permission_code, is_allowed) values
    -- Admin: all permissions
    ('admin','tasks.view',true), ('admin','tasks.create',true),
    ('admin','tasks.edit',true), ('admin','tasks.delete',true),
    ('admin','tasks.change_status',true), ('admin','users.view',true),
    ('admin','users.create',true), ('admin','users.edit',true),
    ('admin','users.delete',true), ('admin','tasks.assign',true),
    ('admin','tasks.restore',true), ('admin','reports.submit',true),
    ('admin','reports.view',true), ('admin','notifications.view',true),
    ('admin','notifications.manage',true), ('admin','site_updates.view',true),
    ('admin','site_updates.manage',true), ('admin','site_updates.files.manage',true),

    -- Developer: all 18 permissions enabled, same as Admin
    ('developer','tasks.view',true), ('developer','tasks.create',true),
    ('developer','tasks.edit',true), ('developer','tasks.delete',true),
    ('developer','tasks.change_status',true), ('developer','users.view',true),
    ('developer','users.create',true), ('developer','users.edit',true),
    ('developer','users.delete',true), ('developer','tasks.assign',true),
    ('developer','tasks.restore',true), ('developer','reports.submit',true),
    ('developer','reports.view',true), ('developer','notifications.view',true),
    ('developer','notifications.manage',true), ('developer','site_updates.view',true),
    ('developer','site_updates.manage',true), ('developer','site_updates.files.manage',true),

    -- Technician: operate jobs and submit Install Reports
    ('technician','tasks.view',true), ('technician','tasks.create',true),
    ('technician','tasks.edit',false), ('technician','tasks.delete',false),
    ('technician','tasks.change_status',true), ('technician','users.view',false),
    ('technician','users.create',false), ('technician','users.edit',false),
    ('technician','users.delete',false), ('technician','tasks.assign',false),
    ('technician','tasks.restore',false), ('technician','reports.submit',true),
    ('technician','reports.view',false), ('technician','notifications.view',true),
    ('technician','notifications.manage',false), ('technician','site_updates.view',true),
    ('technician','site_updates.manage',false), ('technician','site_updates.files.manage',false),

    -- Intern: read-only
    ('intern','tasks.view',true), ('intern','tasks.create',false),
    ('intern','tasks.edit',false), ('intern','tasks.delete',false),
    ('intern','tasks.change_status',false), ('intern','users.view',false),
    ('intern','users.create',false), ('intern','users.edit',false),
    ('intern','users.delete',false), ('intern','tasks.assign',false),
    ('intern','tasks.restore',false), ('intern','reports.submit',false),
    ('intern','reports.view',false), ('intern','notifications.view',true),
    ('intern','notifications.manage',false), ('intern','site_updates.view',true),
    ('intern','site_updates.manage',false), ('intern','site_updates.files.manage',false);

-- ---------------------------------------------------------------------------
-- 2. Profiles: linked 1:1 to Supabase Auth
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    legacy_user_id text unique,
    first_name text not null default '',
    last_name text not null default '',
    email text,
    phone text,
    role_code text not null default 'intern'
        references public.roles(role_code) on update cascade on delete restrict,
    department_id uuid references public.departments(id) on update cascade on delete set null,
    avatar_url text,
    avatar_style text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint profiles_email_format check (email is null or position('@' in email) > 1)
);

create index if not exists idx_profiles_role_code on public.profiles(role_code);
create index if not exists idx_profiles_department_id on public.profiles(department_id);
create index if not exists idx_profiles_active on public.profiles(is_active);

-- Create a least-privileged profile whenever an Auth user is provisioned.
-- The role is always intern here; never trust user-editable user_metadata
-- to assign admin/developer or another privileged role.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    insert into public.profiles (id, first_name, last_name, email, role_code)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'first_name', ''),
        coalesce(new.raw_user_meta_data ->> 'last_name', ''),
        new.email,
        'intern'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_computer_install on auth.users;
create trigger on_auth_user_created_computer_install
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 3. Shared helpers for RLS and updated_at
-- ---------------------------------------------------------------------------
create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select p.role_code
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
    limit 1;
$$;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.profiles p
        join public.role_permissions rp on rp.role_code = p.role_code
        where p.id = auth.uid()
          and p.is_active = true
          and rp.permission_code = p_permission
          and rp.is_allowed = true
    );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

-- Prevent users from promoting themselves or changing protected account fields.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.role() = 'service_role' then
        return new;
    end if;

    -- Even Admin/Developer cannot grant themselves a role or alter their
    -- own protected account fields. They may manage another user's profile.
    if auth.uid() = old.id then
        if new.role_code is distinct from old.role_code
           or new.legacy_user_id is distinct from old.legacy_user_id
           or new.department_id is distinct from old.department_id
           or new.is_active is distinct from old.is_active
           or new.email is distinct from old.email then
            raise exception 'You cannot change your own protected profile fields; ask another authorized Admin/Developer'
                using errcode = '42501';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges
before update on public.profiles
for each row execute function public.protect_profile_privileges();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Install job header and per-machine items
-- ---------------------------------------------------------------------------
create table if not exists public.installs (
    id uuid primary key default gen_random_uuid(),
    job_number text not null unique,
    job_name text,
    owner_user_id uuid references public.profiles(id) on update cascade on delete set null,
    owner_name text,
    created_by uuid references public.profiles(id) on update cascade on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint installs_job_number_not_blank check (length(trim(job_number)) > 0)
);

create index if not exists idx_installs_owner_user on public.installs(owner_user_id);
create index if not exists idx_installs_created_at on public.installs(created_at desc);

create table if not exists public.install_items (
    id uuid primary key default gen_random_uuid(),
    install_id uuid not null references public.installs(id) on update cascade on delete cascade,
    legacy_task_id bigint unique,
    legacy_id text unique,
    department_id uuid references public.departments(id) on update cascade on delete set null,
    legacy_department_id bigint,
    requester_user_id uuid references public.profiles(id) on update cascade on delete set null,
    legacy_requester_user_id text,
    asset_identifier text,
    detail text not null default '',
    status text not null default 'waiting',
    priority text not null default 'medium',
    technician_user_id uuid references public.profiles(id) on update cascade on delete set null,
    technician_name_snapshot text,
    assistant_user_id uuid references public.profiles(id) on update cascade on delete set null,
    assistant_name_snapshot text,
    opened_at date not null default current_date,
    due_at date,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint install_items_status_check
        check (status in ('waiting', 'progress', 'done')),
    constraint install_items_priority_check
        check (priority in ('low', 'medium', 'high')),
    constraint install_items_due_date_check
        check (due_at is null or due_at >= opened_at),
    constraint install_items_asset_not_blank
        check (asset_identifier is null or length(trim(asset_identifier)) > 0)
);

-- Multiple items per job are allowed; a non-empty serial may not repeat
-- within the same job. Empty/null serials can occur more than once.
create unique index if not exists uq_install_items_job_asset
    on public.install_items(install_id, asset_identifier)
    where asset_identifier is not null and length(trim(asset_identifier)) > 0;

create index if not exists idx_install_items_install_id on public.install_items(install_id);
create index if not exists idx_install_items_department on public.install_items(department_id);
create index if not exists idx_install_items_requester on public.install_items(requester_user_id);
create index if not exists idx_install_items_status_due on public.install_items(status, due_at)
    where deleted_at is null;
create index if not exists idx_install_items_technician on public.install_items(technician_user_id)
    where deleted_at is null;
create index if not exists idx_install_items_assistant on public.install_items(assistant_user_id)
    where deleted_at is null;
create index if not exists idx_install_items_deleted_at on public.install_items(deleted_at)
    where deleted_at is not null;
create index if not exists idx_install_items_opened_at on public.install_items(opened_at desc);

drop trigger if exists installs_set_updated_at on public.installs;
create trigger installs_set_updated_at
before update on public.installs
for each row execute function public.set_updated_at();

-- An authenticated client cannot spoof who opened a job.
create or replace function public.force_install_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        new.created_by := auth.uid();
    end if;
    return new;
end;
$$;

drop trigger if exists installs_force_creator on public.installs;
create trigger installs_force_creator
before insert on public.installs
for each row execute function public.force_install_creator();

-- Assigning a linked Owner account is an assignment operation too.
create or replace function public.guard_install_owner_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role'
       and new.owner_user_id is not null
       and (tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id)
       and not public.has_permission('tasks.assign') then
        raise exception 'Assignment permission required' using errcode = '42501';
    end if;
    return new;
end;
$$;

drop trigger if exists installs_guard_owner_assignment on public.installs;
create trigger installs_guard_owner_assignment
before insert or update of owner_user_id on public.installs
for each row execute function public.guard_install_owner_assignment();

drop trigger if exists install_items_set_updated_at on public.install_items;
create trigger install_items_set_updated_at
before update on public.install_items
for each row execute function public.set_updated_at();

-- If an internal Owner/Technician/Assistant is selected, store a display-name
-- snapshot as well. A manually entered Owner is supported by owner_name alone.
create or replace function public.fill_install_name_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.owner_user_id is not null and nullif(trim(coalesce(new.owner_name, '')), '') is null then
        select concat_ws(' ', first_name, last_name)
          into new.owner_name
          from public.profiles
         where id = new.owner_user_id;
    end if;
    return new;
end;
$$;

drop trigger if exists installs_fill_owner_snapshot on public.installs;
create trigger installs_fill_owner_snapshot
before insert or update of owner_user_id, owner_name on public.installs
for each row execute function public.fill_install_name_snapshots();

create or replace function public.fill_assignment_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' and new.requester_user_id is null and auth.uid() is not null then
        new.requester_user_id := auth.uid();
    end if;

    if coalesce(auth.role(), '') <> 'service_role'
       and (
           (tg_op = 'INSERT' and (
               new.technician_user_id is not null
               or new.assistant_user_id is not null
               or (new.requester_user_id is not null and new.requester_user_id <> auth.uid())
           ))
           or (tg_op = 'UPDATE' and (
               new.technician_user_id is distinct from old.technician_user_id
               or new.assistant_user_id is distinct from old.assistant_user_id
               or new.requester_user_id is distinct from old.requester_user_id
           ))
       )
       and not public.has_permission('tasks.assign') then
        raise exception 'Assignment permission required' using errcode = '42501';
    end if;

    if new.technician_user_id is not null
       and (tg_op = 'INSERT' or new.technician_user_id is distinct from old.technician_user_id)
       and nullif(trim(coalesce(new.technician_name_snapshot, '')), '') is null then
        select concat_ws(' ', first_name, last_name)
          into new.technician_name_snapshot
          from public.profiles
         where id = new.technician_user_id;
    end if;

    if new.assistant_user_id is not null
       and (tg_op = 'INSERT' or new.assistant_user_id is distinct from old.assistant_user_id)
       and nullif(trim(coalesce(new.assistant_name_snapshot, '')), '') is null then
        select concat_ws(' ', first_name, last_name)
          into new.assistant_name_snapshot
          from public.profiles
         where id = new.assistant_user_id;
    end if;
    return new;
end;
$$;

drop trigger if exists install_items_fill_assignment_snapshots on public.install_items;
create trigger install_items_fill_assignment_snapshots
before insert or update of technician_user_id, technician_name_snapshot,
                           assistant_user_id, assistant_name_snapshot
on public.install_items
for each row execute function public.fill_assignment_snapshots();

-- ---------------------------------------------------------------------------
-- 5. Status history and re-authentication tickets
-- ---------------------------------------------------------------------------
create table if not exists public.install_status_logs (
    id uuid primary key default gen_random_uuid(),
    legacy_history_id bigint unique,
    install_item_id uuid not null references public.install_items(id) on update cascade on delete cascade,
    old_status text,
    new_status text not null,
    changed_by uuid references public.profiles(id) on update cascade on delete set null,
    legacy_changed_by_user_id text,
    changed_at timestamptz not null default now(),
    constraint install_status_logs_new_status_check
        check (new_status in ('waiting', 'progress', 'done')),
    constraint install_status_logs_old_status_check
        check (old_status is null or old_status in ('waiting', 'progress', 'done'))
);

create index if not exists idx_install_status_logs_item_date
    on public.install_status_logs(install_item_id, changed_at desc);

-- A trusted Edge Function verifies the user's password with Supabase Auth,
-- then inserts a short-lived one-use authorization ticket using service_role.
-- The browser cannot insert/read tickets. The status RPC consumes the ticket
-- when changing progress -> done.
create table if not exists public.status_change_authorizations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on update cascade on delete cascade,
    expires_at timestamptz not null default (now() + interval '2 minutes'),
    consumed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_status_change_auth_user_expiry
    on public.status_change_authorizations(user_id, expires_at)
    where consumed_at is null;

-- Record the initial state for each new machine item.
create or replace function public.log_initial_install_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.install_status_logs
        (install_item_id, old_status, new_status, changed_by)
    values
        (new.id, null, new.status, auth.uid());
    return new;
end;
$$;

drop trigger if exists install_items_log_initial_status on public.install_items;
create trigger install_items_log_initial_status
after insert on public.install_items
for each row execute function public.log_initial_install_status();

-- Status changes are performed only through this RPC, not direct table UPDATE.
create or replace function public.change_install_item_status(
    p_item_id uuid,
    p_new_status text,
    p_reauth_ticket uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_old_status text;
    v_actor uuid := auth.uid();
begin
    if v_actor is null or not public.has_permission('tasks.change_status') then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    if p_new_status not in ('waiting', 'progress', 'done') then
        raise exception 'Invalid status' using errcode = '22023';
    end if;

    select status into v_old_status
      from public.install_items
     where id = p_item_id and deleted_at is null
     for update;

    if not found then
        raise exception 'Install item not found' using errcode = 'P0002';
    end if;

    if v_old_status = p_new_status then
        return;
    end if;

    if v_old_status = 'progress' and p_new_status = 'done' then
        if p_reauth_ticket is null then
            raise exception 'Password re-authentication is required' using errcode = '42501';
        end if;

        update public.status_change_authorizations
           set consumed_at = now()
         where id = p_reauth_ticket
           and user_id = v_actor
           and consumed_at is null
           and expires_at > now();

        if not found then
            raise exception 'Re-authentication ticket is invalid or expired'
                using errcode = '42501';
        end if;
    end if;

    update public.install_items
       set status = p_new_status
     where id = p_item_id;

    insert into public.install_status_logs
        (install_item_id, old_status, new_status, changed_by)
    values
        (p_item_id, v_old_status, p_new_status, v_actor);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Install Reports: one report per machine item
-- ---------------------------------------------------------------------------
create table if not exists public.install_reports (
    id uuid primary key default gen_random_uuid(),
    install_item_id uuid not null unique
        references public.install_items(id) on update cascade on delete cascade,
    checker_user_id uuid not null references public.profiles(id) on update cascade on delete restrict,
    checker_name_snapshot text not null,
    technician_name_snapshot text not null,
    computer_type text not null,
    brand text not null,
    specifications_checked boolean not null default false,
    neatness_checked boolean not null default false,
    warranty_seal_applied boolean not null default false,
    created_at timestamptz not null default now(),
    constraint install_reports_computer_type_not_blank
        check (length(trim(computer_type)) between 1 and 120),
    constraint install_reports_brand_not_blank
        check (length(trim(brand)) between 1 and 120),
    constraint install_reports_checker_not_blank
        check (length(trim(checker_name_snapshot)) > 0),
    constraint install_reports_technician_not_blank
        check (length(trim(technician_name_snapshot)) > 0),
    constraint install_reports_all_checks_required
        check (specifications_checked and neatness_checked and warranty_seal_applied)
);

create index if not exists idx_install_reports_checker on public.install_reports(checker_user_id);
create index if not exists idx_install_reports_created_at on public.install_reports(created_at desc);

create table if not exists public.install_report_photos (
    id uuid primary key default gen_random_uuid(),
    report_id uuid not null references public.install_reports(id) on update cascade on delete cascade,
    storage_path text not null unique,
    uploaded_at timestamptz not null default now(),
    constraint install_report_photo_path_not_blank
        check (length(trim(storage_path)) > 0)
);

create index if not exists idx_install_report_photos_report on public.install_report_photos(report_id);

-- Submit report through one transaction after photos have been uploaded.
-- p_photo_paths must contain 1..5 paths under the matching item UUID folder.
create or replace function public.submit_install_report(
    p_item_id uuid,
    p_computer_type text,
    p_brand text,
    p_specifications_checked boolean,
    p_neatness_checked boolean,
    p_warranty_seal_applied boolean,
    p_photo_paths text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_report_id uuid := gen_random_uuid();
    v_checker_name text;
    v_technician_name text;
    v_item_status text;
    v_path text;
    v_photo_count integer;
begin
    if auth.uid() is null or not public.has_permission('reports.submit') then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    if coalesce(array_length(p_photo_paths, 1), 0) < 1
       or array_length(p_photo_paths, 1) > 5 then
        raise exception 'Report requires between 1 and 5 photos' using errcode = '22023';
    end if;

    if not coalesce(p_specifications_checked, false)
       or not coalesce(p_neatness_checked, false)
       or not coalesce(p_warranty_seal_applied, false) then
        raise exception 'All report checklist items must be confirmed' using errcode = '22023';
    end if;

    select concat_ws(' ', first_name, last_name)
      into v_checker_name
      from public.profiles
     where id = auth.uid() and is_active = true;

    if nullif(trim(coalesce(v_checker_name, '')), '') is null then
        raise exception 'Active checker profile not found' using errcode = '42501';
    end if;

    select i.status,
           coalesce(
               nullif(trim(i.technician_name_snapshot), ''),
               nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
           )
      into v_item_status, v_technician_name
      from public.install_items i
      left join public.profiles p on p.id = i.technician_user_id
     where i.id = p_item_id and i.deleted_at is null
     for update of i;

    if not found or v_item_status <> 'done'
       or nullif(trim(coalesce(v_technician_name, '')), '') is null then
        raise exception 'Only completed items with an assigned technician can be reported'
            using errcode = '23514';
    end if;

    foreach v_path in array p_photo_paths loop
        if v_path is null
           or split_part(v_path, '/', 1) <> p_item_id::text
           or split_part(v_path, '/', 2) = ''
           or split_part(v_path, '/', 3) <> ''
           or length(v_path) > 500 then
            raise exception 'Invalid report photo path' using errcode = '22023';
        end if;

        if not exists (
            select 1
              from storage.objects o
             where o.bucket_id = 'install-report-photos'
               and o.name = v_path
        ) then
            raise exception 'Report photo does not exist in private Storage' using errcode = '23503';
        end if;
    end loop;

    if (select count(distinct p) from unnest(p_photo_paths) as p)
       <> array_length(p_photo_paths, 1) then
        raise exception 'Duplicate report photo paths are not allowed' using errcode = '22023';
    end if;

    insert into public.install_reports (
        id, install_item_id, checker_user_id, checker_name_snapshot,
        technician_name_snapshot, computer_type, brand, specifications_checked,
        neatness_checked, warranty_seal_applied
    ) values (
        v_report_id, p_item_id, auth.uid(), v_checker_name,
        v_technician_name, trim(p_computer_type), trim(p_brand),
        p_specifications_checked, p_neatness_checked, p_warranty_seal_applied
    );

    insert into public.install_report_photos (report_id, storage_path)
    select v_report_id, distinct_path
    from (
        select distinct unnest(p_photo_paths) as distinct_path
    ) paths;

    select count(*) into v_photo_count
      from public.install_report_photos
     where report_id = v_report_id;

    if v_photo_count < 1 or v_photo_count > 5 then
        raise exception 'Invalid number of report photos' using errcode = '22023';
    end if;

    return v_report_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    legacy_notification_id bigint unique,
    user_id uuid not null references public.profiles(id) on update cascade on delete cascade,
    legacy_recipient_user_id text,
    install_id uuid references public.installs(id) on update cascade on delete set null,
    install_item_id uuid references public.install_items(id) on update cascade on delete set null,
    event_type text not null,
    title text not null,
    message text not null,
    is_read boolean not null default false,
    created_at timestamptz not null default now(),
    constraint notifications_event_type_not_blank check (length(trim(event_type)) > 0),
    constraint notifications_title_not_blank check (length(trim(title)) > 0)
);

create index if not exists idx_notifications_user_unread_created
    on public.notifications(user_id, is_read, created_at desc);
create index if not exists idx_notifications_install_item
    on public.notifications(install_item_id);

-- ---------------------------------------------------------------------------
-- 8. Site Updates and tracked file metadata
-- ---------------------------------------------------------------------------
create table if not exists public.site_updates (
    id uuid primary key default gen_random_uuid(),
    legacy_update_id bigint unique,
    title text not null,
    summary text not null,
    changes_json jsonb not null default '[]'::jsonb,
    published_by uuid not null references public.profiles(id) on update cascade on delete restrict,
    published_at timestamptz not null default now(),
    is_published boolean not null default true,
    constraint site_updates_title_not_blank check (length(trim(title)) between 1 and 120),
    constraint site_updates_summary_not_blank check (length(trim(summary)) between 1 and 500),
    constraint site_updates_changes_array check (jsonb_typeof(changes_json) = 'array')
);

create index if not exists idx_site_updates_published
    on public.site_updates(is_published, published_at desc);

create or replace function public.force_site_update_publisher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        if tg_op = 'INSERT' then
            new.published_by := auth.uid();
        elsif new.published_by is distinct from old.published_by then
            raise exception 'Publisher cannot be changed by the client' using errcode = '42501';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists site_updates_force_publisher on public.site_updates;
create trigger site_updates_force_publisher
before insert or update of published_by on public.site_updates
for each row execute function public.force_site_update_publisher();

create table if not exists public.site_update_reads (
    update_id uuid not null references public.site_updates(id) on update cascade on delete cascade,
    user_id uuid not null references public.profiles(id) on update cascade on delete cascade,
    read_at timestamptz not null default now(),
    primary key (update_id, user_id)
);

create index if not exists idx_site_update_reads_user on public.site_update_reads(user_id, read_at desc);

create table if not exists public.site_update_files (
    file_path text primary key,
    file_hash char(64) not null,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id) on update cascade on delete set null,
    constraint site_update_files_path_not_blank check (length(trim(file_path)) > 0),
    constraint site_update_files_sha256 check (file_hash ~ '^[0-9a-fA-F]{64}$')
);

create table if not exists public.app_settings (
    setting_key text primary key,
    setting_value jsonb not null,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id) on update cascade on delete set null,
    constraint app_settings_key_not_blank check (length(trim(setting_key)) > 0)
);

insert into public.app_settings (setting_key, setting_value)
values ('developer_visible_to_admins', 'false'::jsonb)
on conflict (setting_key) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Trash functions and scheduled purge
-- ---------------------------------------------------------------------------
-- Soft delete and restore are RPC-only. No direct DELETE policy is granted.
create or replace function public.soft_delete_install_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null or not public.has_permission('tasks.delete') then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    update public.install_items
       set deleted_at = now()
     where id = p_item_id and deleted_at is null;

    if not found then
        raise exception 'Active install item not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.restore_install_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null or not public.has_permission('tasks.restore') then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    update public.install_items
       set deleted_at = null
     where id = p_item_id
       and deleted_at is not null
       and deleted_at > now() - interval '30 days';

    if not found then
        raise exception 'Item not found or restore period expired' using errcode = 'P0002';
    end if;
end;
$$;

-- Run this function from a trusted scheduled job (for example, Supabase
-- Scheduled Functions / Edge Function). Storage objects must be removed by
-- that trusted job before deleting their DB rows; SQL cannot cascade-delete
-- files from Supabase Storage.
create or replace function public.purge_expired_install_items()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted integer;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;

    -- The trusted cleanup job must remove Storage objects first. Do not cascade
    -- away report metadata while its image files still exist in Storage.
    if exists (
        select 1
          from storage.objects o
          join public.install_items i
            on i.id::text = split_part(o.name, '/', 1)
         where o.bucket_id = 'install-report-photos'
           and i.deleted_at is not null
           and i.deleted_at <= now() - interval '30 days'
    ) then
        raise exception 'Expired items still have Storage files; clean Storage first.'
            using errcode = '55000';
    end if;

    delete from public.install_items
     where deleted_at is not null
       and deleted_at <= now() - interval '30 days';

    get diagnostics v_deleted = row_count;

    delete from public.installs h
     where not exists (
         select 1 from public.install_items i where i.install_id = h.id
     );

    return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. RLS enablement
-- ---------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.departments enable row level security;
alter table public.legacy_user_role_map enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.installs enable row level security;
alter table public.install_items enable row level security;
alter table public.install_status_logs enable row level security;
alter table public.status_change_authorizations enable row level security;
alter table public.install_reports enable row level security;
alter table public.install_report_photos enable row level security;
alter table public.notifications enable row level security;
alter table public.site_updates enable row level security;
alter table public.site_update_reads enable row level security;
alter table public.site_update_files enable row level security;
alter table public.app_settings enable row level security;

-- Drop policies if re-running this draft in a disposable project.
drop policy if exists roles_read_authenticated on public.roles;
drop policy if exists roles_manage_admin on public.roles;
create policy roles_read_authenticated on public.roles
for select to authenticated using (auth.uid() is not null);
create policy roles_manage_admin on public.roles
for all to authenticated
using (public.has_permission('users.edit'))
with check (public.has_permission('users.edit'));

drop policy if exists departments_read_authenticated on public.departments;
drop policy if exists departments_manage_admin on public.departments;
create policy departments_read_authenticated on public.departments
for select to authenticated using (auth.uid() is not null);
create policy departments_manage_admin on public.departments
for all to authenticated
using (public.has_permission('users.edit'))
with check (public.has_permission('users.edit'));

drop policy if exists profiles_read_self_or_authorized on public.profiles;
drop policy if exists profiles_update_self_or_admin on public.profiles;
drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_read_self_or_authorized on public.profiles
for select to authenticated
using (id = auth.uid() or public.has_permission('users.view'));
create policy profiles_update_self_or_admin on public.profiles
for update to authenticated
using (id = auth.uid() or public.has_permission('users.edit'))
with check (id = auth.uid() or public.has_permission('users.edit'));
create policy profiles_delete_admin on public.profiles
for delete to authenticated
using (public.has_permission('users.delete'));

drop policy if exists role_permissions_read_own_or_admin on public.role_permissions;
drop policy if exists role_permissions_manage_admin on public.role_permissions;
create policy role_permissions_read_own_or_admin on public.role_permissions
for select to authenticated
using (
    role_code = public.current_role_code()
    or public.has_permission('users.edit')
);
create policy role_permissions_manage_admin on public.role_permissions
for all to authenticated
using (public.has_permission('users.edit'))
with check (public.has_permission('users.edit'));

drop policy if exists installs_read on public.installs;
drop policy if exists installs_insert on public.installs;
drop policy if exists installs_update on public.installs;
create policy installs_read on public.installs
for select to authenticated
using (public.has_permission('tasks.view'));
create policy installs_insert on public.installs
for insert to authenticated
with check (
    public.has_permission('tasks.create')
    and created_by = auth.uid()
);
create policy installs_update on public.installs
for update to authenticated
using (public.has_permission('tasks.edit'))
with check (public.has_permission('tasks.edit'));

drop policy if exists install_items_read_active_or_trash on public.install_items;
drop policy if exists install_items_insert on public.install_items;
drop policy if exists install_items_update on public.install_items;
create policy install_items_read_active_or_trash on public.install_items
for select to authenticated
using (
    public.has_permission('tasks.view')
    and (deleted_at is null or public.has_permission('tasks.delete'))
);
create policy install_items_insert on public.install_items
for insert to authenticated
with check (
    public.has_permission('tasks.create')
    and status = 'waiting'
    and deleted_at is null
);
create policy install_items_update on public.install_items
for update to authenticated
using (public.has_permission('tasks.edit') and deleted_at is null)
with check (public.has_permission('tasks.edit') and deleted_at is null);

drop policy if exists install_status_logs_read on public.install_status_logs;
create policy install_status_logs_read on public.install_status_logs
for select to authenticated
using (public.has_permission('tasks.view'));

drop policy if exists install_reports_read on public.install_reports;
create policy install_reports_read on public.install_reports
for select to authenticated
using (
    public.has_permission('reports.view')
    or checker_user_id = auth.uid()
);

drop policy if exists install_report_photos_read on public.install_report_photos;
create policy install_report_photos_read on public.install_report_photos
for select to authenticated
using (
    exists (
        select 1
        from public.install_reports r
        where r.id = report_id
          and (public.has_permission('reports.view') or r.checker_user_id = auth.uid())
    )
);

drop policy if exists notifications_read_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_read_own on public.notifications
for select to authenticated
using (user_id = auth.uid() and public.has_permission('notifications.view'));
create policy notifications_update_own on public.notifications
for update to authenticated
using (user_id = auth.uid() and public.has_permission('notifications.view'))
with check (user_id = auth.uid() and public.has_permission('notifications.view'));

drop policy if exists site_updates_read_published on public.site_updates;
drop policy if exists site_updates_manage on public.site_updates;
create policy site_updates_read_published on public.site_updates
for select to authenticated
using (
    public.has_permission('site_updates.view')
    and (is_published or public.has_permission('site_updates.manage'))
);
create policy site_updates_manage on public.site_updates
for all to authenticated
using (public.has_permission('site_updates.manage'))
with check (public.has_permission('site_updates.manage'));

drop policy if exists site_update_reads_own on public.site_update_reads;
drop policy if exists site_update_reads_manage_own on public.site_update_reads;
create policy site_update_reads_own on public.site_update_reads
for select to authenticated using (user_id = auth.uid());
create policy site_update_reads_manage_own on public.site_update_reads
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists site_update_files_read on public.site_update_files;
drop policy if exists site_update_files_manage on public.site_update_files;
create policy site_update_files_read on public.site_update_files
for select to authenticated
using (public.has_permission('site_updates.view'));
create policy site_update_files_manage on public.site_update_files
for all to authenticated
using (public.has_permission('site_updates.files.manage'))
with check (public.has_permission('site_updates.files.manage'));

drop policy if exists app_settings_read on public.app_settings;
drop policy if exists app_settings_manage on public.app_settings;
create policy app_settings_read on public.app_settings
for select to authenticated
using (
    setting_key <> 'developer_visible_to_admins'
    or public.current_role_code() in ('admin', 'developer')
);
create policy app_settings_manage on public.app_settings
for all to authenticated
using (public.has_permission('users.edit'))
with check (public.has_permission('users.edit'));

-- There are intentionally no client policies for authorization tickets.
-- There are intentionally no direct INSERT policies for notifications or reports.

-- ---------------------------------------------------------------------------
-- 11. Explicit grants: RLS is paired with least-privilege SQL grants
-- ---------------------------------------------------------------------------
revoke all on public.roles, public.departments, public.role_permissions,
    public.legacy_user_role_map, public.profiles, public.installs,
    public.install_items, public.install_status_logs,
    public.status_change_authorizations, public.install_reports,
    public.install_report_photos, public.notifications, public.site_updates,
    public.site_update_reads, public.site_update_files, public.app_settings
from anon, authenticated;

-- The legacy mapping contains employee identifiers and is service-only.
grant all on public.legacy_user_role_map to service_role;

-- Supabase service role is for trusted server-side migration/Edge Functions only.
grant all on public.roles, public.departments, public.role_permissions,
    public.profiles, public.installs, public.install_items,
    public.install_status_logs, public.status_change_authorizations,
    public.install_reports, public.install_report_photos, public.notifications,
    public.site_updates, public.site_update_reads, public.site_update_files,
    public.app_settings to service_role;

-- Authenticated app access.
grant select on public.roles, public.departments, public.role_permissions,
    public.profiles, public.installs, public.install_items,
    public.install_status_logs, public.install_reports,
    public.install_report_photos, public.notifications,
    public.site_updates, public.site_update_reads,
    public.site_update_files, public.app_settings
to authenticated;

grant insert (job_number, job_name, owner_user_id, owner_name)
    on public.installs to authenticated;
revoke update on public.installs from anon, authenticated;
grant update (job_number, job_name, owner_user_id, owner_name)
    on public.installs to authenticated;

grant insert (
    install_id,
    department_id,
    requester_user_id,
    asset_identifier,
    detail,
    status,
    priority,
    technician_user_id,
    technician_name_snapshot,
    assistant_user_id,
    assistant_name_snapshot,
    opened_at,
    due_at
) on public.install_items to authenticated;
revoke update on public.install_items from anon, authenticated;
grant update (
    department_id,
    requester_user_id,
    asset_identifier,
    detail,
    priority,
    technician_user_id,
    technician_name_snapshot,
    assistant_user_id,
    assistant_name_snapshot,
    opened_at,
    due_at
) on public.install_items to authenticated;

grant update (is_read) on public.notifications to authenticated;
grant insert, update, delete on public.site_updates to authenticated;
grant insert, update, delete on public.site_update_reads to authenticated;
grant insert, update, delete on public.site_update_files to authenticated;
grant update on public.profiles to authenticated;
grant insert, update, delete on public.departments, public.roles,
    public.role_permissions, public.app_settings to authenticated;

-- Helper execution rights used by RLS policies.
revoke all on function public.current_role_code() from public, anon;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.current_role_code() to authenticated, service_role;
grant execute on function public.has_permission(text) to authenticated, service_role;

-- RPC execution rights
revoke all on function public.change_install_item_status(uuid, text, uuid) from public, anon;
grant execute on function public.change_install_item_status(uuid, text, uuid) to authenticated;

revoke all on function public.submit_install_report(uuid, text, text, boolean, boolean, boolean, text[]) from public, anon;
grant execute on function public.submit_install_report(uuid, text, text, boolean, boolean, boolean, text[]) to authenticated;

revoke all on function public.soft_delete_install_item(uuid) from public, anon;
grant execute on function public.soft_delete_install_item(uuid) to authenticated;

revoke all on function public.restore_install_item(uuid) from public, anon;
grant execute on function public.restore_install_item(uuid) to authenticated;

revoke all on function public.purge_expired_install_items() from public, anon, authenticated;
grant execute on function public.purge_expired_install_items() to service_role;

-- ---------------------------------------------------------------------------
-- 12. Supabase Storage: private bucket for Install Report photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'install-report-photos',
    'install-report-photos',
    false,
    800000,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists install_report_photos_upload on storage.objects;
drop policy if exists install_report_photos_read on storage.objects;
drop policy if exists install_report_photos_delete on storage.objects;

-- Upload to: <install_item_uuid>/<unique-filename>
create policy install_report_photos_upload on storage.objects
for insert to authenticated
with check (
    bucket_id = 'install-report-photos'
    and public.has_permission('reports.submit')
    and exists (
        select 1
        from public.install_items i
        where i.id::text = split_part(name, '/', 1)
          and split_part(name, '/', 2) <> ''
          and split_part(name, '/', 3) = ''
          and i.status = 'done'
          and i.deleted_at is null
          and nullif(trim(coalesce(i.technician_name_snapshot, '')), '') is not null
    )
);

create policy install_report_photos_read on storage.objects
for select to authenticated
using (
    bucket_id = 'install-report-photos'
    and exists (
        select 1
        from public.install_report_photos p
        join public.install_reports r on r.id = p.report_id
        where p.storage_path = name
          and (public.has_permission('reports.view') or r.checker_user_id = auth.uid())
    )
);

create policy install_report_photos_delete on storage.objects
for delete to authenticated
using (
    bucket_id = 'install-report-photos'
    and public.has_permission('users.delete')
);

commit;

-- ============================================================================
-- POST-SCHEMA / GO-LIVE NOTES (not executable SQL)
-- ============================================================================
-- 1. The initial application data is clean: no profiles, installs, install_items,
--    status logs, reports, notifications, Site Updates or Site Update files are seeded.
-- 2. legacy_user_role_map contains exactly one row: the former Developer (Dev 0).
--    The other seven old user records are intentionally excluded.
-- 3. No PHP password hash is migrated. Create the one Developer login through
--    Supabase Authentication, then run Computer-Install-Supabase-Developer-Bootstrap-v3.2.sql.
--    That script checks there is exactly one matching Auth user before creating/updating
--    the profile and assigning the Developer role. Do not create other accounts yet.
-- 4. Departments start with only ช่าง, นักศึกษาฝึกงาน and Store. The discontinued
--    executive, head-technician, sales and accounting department rows are omitted.
-- 5. Admin and Developer have identical permissions: all 18 permission codes enabled.
--    No Admin account is provisioned; the single initial account is Developer.
-- 6. This schema is one-time initial installation. The guard at the top rejects
--    running it when the core schema already exists. Do not rerun it after success.
-- 7. A trusted Edge Function is still required to:
--      a) verify password re-authentication and create a one-use ticket;
--      b) create notifications (client inserts are intentionally blocked);
--      c) remove expired Storage objects before calling purge_expired_install_items;
--      d) provision future users safely after the initial single-Developer phase.
-- 8. Site Updates file hashes are metadata only. GitHub Pages cannot scan a
--    server folder; an authorized GitHub Action or Edge Function is required.
-- 9. Before production, run RLS tests with each role and verify every authenticated
--    action through the website/API. Developer has broad destructive privileges.
-- ============================================================================
