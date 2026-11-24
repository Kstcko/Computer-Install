-- Computer-Install | Supabase v3.2 verification (read-only)
-- Run after Schema-v3.2-Clean.sql. Run after Developer-Bootstrap-v3.2.sql
-- to verify the single Developer profile as well.

-- 1) Four role definitions; no retired roles.
select role_code, role_name
from public.roles
order by role_code;

-- 2) Each role has 18 permission rows. Developer must have 18 allowed.
select role_code,
       count(*) as permission_count,
       count(*) filter (where is_allowed) as allowed_count
from public.role_permissions
group by role_code
order by role_code;

-- Expected: zero rows (Admin and Developer permission matrices are identical).
select coalesce(a.permission_code, d.permission_code) as permission_code,
       a.is_allowed as admin_allowed,
       d.is_allowed as developer_allowed
from public.role_permissions a
full join public.role_permissions d
  on d.permission_code = a.permission_code
 and d.role_code = 'developer'
where a.role_code = 'admin'
  and a.is_allowed is distinct from d.is_allowed;

-- 3) Exactly one retained Developer mapping; no other old users.
select legacy_user_id, first_name, last_name, target_role_code,
       provision_active, is_test_account
from public.legacy_user_role_map;

select count(*) as retained_user_mappings,
       count(*) filter (where target_role_code = 'developer' and provision_active) as active_developer_mappings
from public.legacy_user_role_map;

-- 4) Only the three intended departments are seeded.
select department_code, department_name
from public.departments
order by department_code;

-- 5) Before Developer Bootstrap: profiles should be zero.
--    After Developer Bootstrap: exactly one active Developer profile should exist.
select count(*) as profile_count,
       count(*) filter (where role_code = 'developer' and is_active) as active_developer_count
from public.profiles;

-- 6) These operational tables should all be empty on initial setup.
select 'installs' as table_name, count(*) as row_count from public.installs
union all select 'install_items', count(*) from public.install_items
union all select 'install_status_logs', count(*) from public.install_status_logs
union all select 'install_reports', count(*) from public.install_reports
union all select 'install_report_photos', count(*) from public.install_report_photos
union all select 'notifications', count(*) from public.notifications
union all select 'site_updates', count(*) from public.site_updates
union all select 'site_update_reads', count(*) from public.site_update_reads
union all select 'site_update_files', count(*) from public.site_update_files
order by table_name;

-- 7) Confirm RLS is enabled on every application table.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
      'roles','departments','legacy_user_role_map','role_permissions','profiles',
      'installs','install_items','install_status_logs','status_change_authorizations',
      'install_reports','install_report_photos','notifications','site_updates',
      'site_update_reads','site_update_files','app_settings'
  )
order by c.relname;

-- 8) Install Report photo bucket must be private.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'install-report-photos';
