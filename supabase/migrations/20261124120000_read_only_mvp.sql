-- REVIEW ONLY: this migration has not been executed.
-- HARD-LOCKED: the preflight aborts before any change until a complete,
-- owner-reviewed Production inventory is available and the preflight is
-- upgraded to compare that inventory exactly. Do not remove the lock based on
-- partial policy fragments or an unverified claim.
-- Do not put a Service Role key in the browser. RLS remains a required layer.

begin;

do $preflight$
declare
  expected_tables text[] := array[
    'roles',
    'departments',
    'legacy_user_role_map',
    'role_permissions',
    'profiles',
    'installs',
    'install_items',
    'install_status_logs',
    'status_change_authorizations',
    'install_reports',
    'install_report_photos',
    'notifications',
    'site_updates',
    'site_update_reads',
    'site_update_files',
    'app_settings'
  ];
  required_read_policies text[] := array[
    'roles_read_authenticated',
    'departments_read_authenticated',
    'profiles_read_self_or_authorized',
    'role_permissions_read_own_or_admin',
    'installs_read',
    'install_items_read_active_or_trash',
    'install_status_logs_read',
    'install_reports_read',
    'install_report_photos_read',
    'notifications_read_own',
    'site_updates_read_published',
    'site_update_reads_own',
    'site_update_files_read',
    'app_settings_read'
  ];
  required_policy_tables text[] := array[
    'roles',
    'departments',
    'profiles',
    'role_permissions',
    'installs',
    'install_items',
    'install_status_logs',
    'install_reports',
    'install_report_photos',
    'notifications',
    'site_updates',
    'site_update_reads',
    'site_update_files',
    'app_settings'
  ];
  item text;
  missing_items text;
  v_full_audit_approved boolean := false;
begin
  if not v_full_audit_approved then
    raise exception 'BLOCKED: complete the full Production security inventory and exact v3.2 comparison before enabling this migration'
      using errcode = '55000';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Read-only migration stopped: expected Supabase API roles are missing';
  end if;

  select string_agg(required.name, ', ' order by required.name)
    into missing_items
    from unnest(expected_tables) as required(name)
   where to_regclass(format('public.%I', required.name)) is null;
  if missing_items is not null then
    raise exception 'Read-only migration stopped: expected v3.2 tables are missing: %', missing_items;
  end if;

  select string_agg(actual.relname, ', ' order by actual.relname)
    into missing_items
    from pg_class actual
    join pg_namespace namespace on namespace.oid = actual.relnamespace
   where namespace.nspname = 'public'
     and actual.relkind in ('r', 'p')
     and not (actual.relname = any(expected_tables));
  if missing_items is not null then
    raise exception 'Read-only migration stopped: unexpected public tables require manual review: %', missing_items;
  end if;

  select string_agg(required.table_name || '.' || required.column_name, ', '
                    order by required.table_name, required.column_name)
    into missing_items
    from (values
      ('install_items', 'id'),
      ('install_items', 'status'),
      ('install_items', 'deleted_at'),
      ('status_change_authorizations', 'id'),
      ('status_change_authorizations', 'user_id'),
      ('status_change_authorizations', 'consumed_at'),
      ('status_change_authorizations', 'expires_at'),
      ('install_status_logs', 'install_item_id'),
      ('install_status_logs', 'old_status'),
      ('install_status_logs', 'new_status'),
      ('install_status_logs', 'changed_by')
    ) as required(table_name, column_name)
   where not exists (
     select 1
       from pg_attribute attribute
      where attribute.attrelid = to_regclass(format('public.%I', required.table_name))
        and attribute.attname = required.column_name
        and attribute.attnum > 0
        and not attribute.attisdropped
   );
  if missing_items is not null then
    raise exception 'Read-only migration stopped: required v3.2 columns are missing: %', missing_items;
  end if;

  foreach item in array expected_tables loop
    if not exists (
      select 1
        from pg_class relation
       where relation.oid = to_regclass(format('public.%I', item))
         and relation.relrowsecurity
    ) then
      raise exception 'Read-only migration stopped: RLS is not enabled on public.%', item;
    end if;
  end loop;

  foreach item in array required_read_policies loop
    if not exists (
      select 1
        from pg_policies policy
       where policy.schemaname = 'public'
         and policy.policyname = item
         and policy.cmd = 'SELECT'
         and policy.roles @> array['authenticated']::name[]
    ) then
      raise exception 'Read-only migration stopped: expected SELECT policy % is missing or differs', item;
    end if;
  end loop;

  foreach item in array required_policy_tables loop
    if not exists (
      select 1
        from pg_policies policy
       where policy.schemaname = 'public'
         and policy.tablename = item
         and policy.cmd = 'SELECT'
         and policy.roles @> array['authenticated']::name[]
    ) then
      raise exception 'Read-only migration stopped: no authenticated SELECT policy found on public.%', item;
    end if;
  end loop;

  if to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null then
    raise exception 'Read-only migration stopped: Supabase Storage relations are unavailable';
  end if;
  if not exists (
    select 1 from pg_class relation
     where relation.oid = to_regclass('storage.objects')
       and relation.relrowsecurity
  ) then
    raise exception 'Read-only migration stopped: RLS is not enabled on storage.objects';
  end if;
  if not exists (
    select 1 from storage.buckets
     where id = 'install-report-photos'
       and name = 'install-report-photos'
       and public = false
  ) then
    raise exception 'Read-only migration stopped: expected private install-report-photos bucket is missing or public';
  end if;
  foreach item in array array[
    'install_report_photos_upload',
    'install_report_photos_read',
    'install_report_photos_delete'
  ] loop
    if not exists (
      select 1 from pg_policies policy
       where policy.schemaname = 'storage'
         and policy.tablename = 'objects'
         and policy.policyname = item
    ) then
      raise exception 'Read-only migration stopped: expected Storage policy % is missing', item;
    end if;
  end loop;

  if to_regprocedure('public.change_install_item_status(uuid,text,uuid)') is null
     or to_regprocedure('public.submit_install_report(uuid,text,text,boolean,boolean,boolean,text[])') is null
     or to_regprocedure('public.soft_delete_install_item(uuid)') is null
     or to_regprocedure('public.restore_install_item(uuid)') is null then
    raise exception 'Read-only migration stopped: expected v3.2 mutation RPC signatures do not match';
  end if;
end;
$preflight$;

-- Enforce the future-approved status workflow within the database RPC.
-- Authenticated execution is revoked below while the MVP is read-only.
create or replace function public.change_install_item_status(
    p_item_id uuid,
    p_new_status text,
    p_reauth_ticket uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
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

    select item.status
      into v_old_status
      from public.install_items as item
     where item.id = p_item_id
       and item.deleted_at is null
     for update;

    if not found then
        raise exception 'Install item not found' using errcode = 'P0002';
    end if;

    if v_old_status = p_new_status then
        return;
    end if;

    if v_old_status = 'waiting' and p_new_status = 'progress' then
        null;
    elsif v_old_status = 'progress' and p_new_status = 'done' then
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
    else
        raise exception 'Invalid status transition' using errcode = '22023';
    end if;

    update public.install_items as item
       set status = p_new_status
     where item.id = p_item_id;

    insert into public.install_status_logs
        (install_item_id, old_status, new_status, changed_by)
    values
        (p_item_id, v_old_status, p_new_status, v_actor);
end;
$function$;

-- Block all client business-data writes, including column-level grants.
do $revoke_table_writes$
declare
  relation record;
  column_record record;
begin
  for relation in
    select namespace.nspname as schema_name, table_info.relname as table_name
      from pg_class table_info
      join pg_namespace namespace on namespace.oid = table_info.relnamespace
     where namespace.nspname = 'public'
       and table_info.relkind in ('r', 'p')
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on table %I.%I from public, anon, authenticated',
      relation.schema_name,
      relation.table_name
    );

    for column_record in
      select attribute.attname as column_name
        from pg_attribute attribute
       where attribute.attrelid = format('%I.%I', relation.schema_name, relation.table_name)::regclass
         and attribute.attnum > 0
         and not attribute.attisdropped
    loop
      execute format(
        'revoke insert (%I), update (%I) on table %I.%I from public, anon, authenticated',
        column_record.column_name,
        column_record.column_name,
        relation.schema_name,
        relation.table_name
      );
    end loop;
  end loop;
end;
$revoke_table_writes$;

-- Storage write policies remain in place, but authenticated clients cannot
-- perform Storage object DML through PostgREST while this MVP is read-only.
revoke insert, update, delete, truncate, references, trigger
  on table storage.objects from public, anon, authenticated;

revoke execute on function public.change_install_item_status(uuid, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.submit_install_report(uuid, text, text, boolean, boolean, boolean, text[])
  from public, anon, authenticated;
revoke execute on function public.soft_delete_install_item(uuid)
  from public, anon, authenticated;
revoke execute on function public.restore_install_item(uuid)
  from public, anon, authenticated;

commit;

-- Rollback is intentionally not automated: restoring the v3.2 write grants
-- would reopen every mutation blocked above. It requires a separate approval,
-- schema re-audit, and a reviewed least-privilege grant migration.
