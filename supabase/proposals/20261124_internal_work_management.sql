-- PROPOSAL ONLY. Not a migration and not executed.
-- Do not remove the hard lock until the complete Production schema, policies,
-- grants, and function inventory have been owner-reviewed against Schema v3.2.
-- This proposal preserves install_items, status history, and reports when a
-- parent install is archived. It does not add a parent purge.

begin;

do $preflight$
declare
    v_change_approved boolean := false;
begin
    if not v_change_approved then
        raise exception 'BLOCKED: review the Production inventory and explicitly approve this local proposal before any DDL'
            using errcode = '55000';
    end if;

    if to_regclass('public.installs') is null
       or to_regclass('public.install_items') is null then
        raise exception 'BLOCKED: expected Schema v3.2 install tables are missing'
            using errcode = '55000';
    end if;

    if not exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'installs'
           and column_name = 'job_number'
           and data_type = 'text'
    ) or not exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'install_items'
           and column_name = 'install_id'
           and data_type = 'uuid'
    ) then
        raise exception 'BLOCKED: Production install schema does not match the reviewed v3.2 contract'
            using errcode = '55000';
    end if;
end;
$preflight$;

alter table public.installs
    add column if not exists deleted_at timestamptz;

create index if not exists idx_installs_deleted_at
    on public.installs(deleted_at)
    where deleted_at is not null;

drop policy if exists installs_read on public.installs;
create policy installs_read on public.installs
for select to authenticated
using (
    public.has_permission('tasks.view')
    and (deleted_at is null or public.has_permission('tasks.delete'))
);

drop policy if exists installs_update on public.installs;
create policy installs_update on public.installs
for update to authenticated
using (public.has_permission('tasks.edit') and deleted_at is null)
with check (public.has_permission('tasks.edit') and deleted_at is null);

drop policy if exists install_items_read_active_or_trash on public.install_items;
create policy install_items_read_active_or_trash on public.install_items
for select to authenticated
using (
    public.has_permission('tasks.view')
    and (deleted_at is null or public.has_permission('tasks.delete'))
    and exists (
        select 1
          from public.installs as parent
         where parent.id = install_id
           and (parent.deleted_at is null or public.has_permission('tasks.delete'))
    )
);

drop policy if exists install_items_insert on public.install_items;
create policy install_items_insert on public.install_items
for insert to authenticated
with check (
    public.has_permission('tasks.create')
    and status = 'waiting'
    and deleted_at is null
    and exists (
        select 1
          from public.installs as parent
         where parent.id = install_id
           and parent.deleted_at is null
    )
);

drop policy if exists install_items_update on public.install_items;
create policy install_items_update on public.install_items
for update to authenticated
using (
    public.has_permission('tasks.edit')
    and deleted_at is null
    and exists (
        select 1
          from public.installs as parent
         where parent.id = install_id
           and parent.deleted_at is null
    )
)
with check (
    public.has_permission('tasks.edit')
    and deleted_at is null
    and exists (
        select 1
          from public.installs as parent
         where parent.id = install_id
           and parent.deleted_at is null
    )
);

create or replace function public.create_install_with_items(
    p_job_number text,
    p_job_name text,
    p_owner_name text,
    p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_install_id uuid;
    v_item jsonb;
    v_department_id uuid;
    v_asset_identifier text;
    v_detail text;
    v_priority text;
    v_opened_at date;
    v_due_at date;
begin
    if auth.uid() is null or not public.has_permission('tasks.create') then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    if nullif(btrim(coalesce(p_job_number, '')), '') is null then
        raise exception 'Job number is required' using errcode = '22023';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'At least one install item is required' using errcode = '22023';
    end if;

    insert into public.installs (job_number, job_name, owner_name)
    values (
        btrim(p_job_number),
        nullif(btrim(coalesce(p_job_name, '')), ''),
        nullif(btrim(coalesce(p_owner_name, '')), '')
    )
    returning id into v_install_id;

    for v_item in
        select value
          from jsonb_array_elements(p_items)
    loop
        if jsonb_typeof(v_item) <> 'object' then
            raise exception 'Each install item must be an object' using errcode = '22023';
        end if;

        v_department_id := nullif(btrim(coalesce(v_item->>'department_id', '')), '')::uuid;
        v_asset_identifier := nullif(btrim(coalesce(v_item->>'asset_identifier', '')), '');
        v_detail := nullif(btrim(coalesce(v_item->>'detail', '')), '');
        v_priority := coalesce(nullif(btrim(coalesce(v_item->>'priority', '')), ''), 'medium');
        v_opened_at := coalesce(nullif(v_item->>'opened_at', '')::date, current_date);
        v_due_at := nullif(v_item->>'due_at', '')::date;

        if v_detail is null then
            raise exception 'Install item detail is required' using errcode = '22023';
        end if;
        if v_priority not in ('low', 'medium', 'high') then
            raise exception 'Invalid install item priority' using errcode = '22023';
        end if;
        if v_due_at is not null and v_due_at < v_opened_at then
            raise exception 'Due date cannot be before opened date' using errcode = '22023';
        end if;

        insert into public.install_items (
            install_id,
            department_id,
            requester_user_id,
            asset_identifier,
            detail,
            status,
            priority,
            opened_at,
            due_at
        ) values (
            v_install_id,
            v_department_id,
            auth.uid(),
            v_asset_identifier,
            v_detail,
            'waiting',
            v_priority,
            v_opened_at,
            v_due_at
        );
    end loop;

    return v_install_id;
end;
$$;

create or replace function public.soft_delete_install(p_install_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null or not public.has_permission('tasks.delete') then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    update public.installs
       set deleted_at = now()
     where id = p_install_id
       and deleted_at is null;

    if not found then
        raise exception 'Active install not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.restore_install(p_install_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null or not public.has_permission('tasks.restore') then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    update public.installs
       set deleted_at = null
     where id = p_install_id
       and deleted_at is not null;

    if not found then
        raise exception 'Archived install not found' using errcode = 'P0002';
    end if;
end;
$$;

revoke all on function public.create_install_with_items(text, text, text, jsonb)
    from public, anon;
revoke all on function public.soft_delete_install(uuid)
    from public, anon;
revoke all on function public.restore_install(uuid)
    from public, anon;

grant execute on function public.create_install_with_items(text, text, text, jsonb)
    to authenticated;
grant execute on function public.soft_delete_install(uuid)
    to authenticated;
grant execute on function public.restore_install(uuid)
    to authenticated;

commit;
