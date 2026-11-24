-- PHASE 1.5: complete Supabase security inventory (read-only).
-- Every statement below is a SELECT over PostgreSQL/Supabase catalogs or
-- Storage metadata. It does not read business rows or change database state.
-- Inspect results in the authorized Supabase SQL Editor; do not share raw
-- outputs containing internal function source or identifiers publicly.

-- 1) Server and PostgREST schema exposure settings.
select
  current_setting('server_version', true) as postgres_version,
  current_setting('pgrst.db_schemas', true) as postgrest_db_schemas,
  current_setting('pgrst.db_extra_search_path', true) as postgrest_extra_search_path;

-- 2) Roles relevant to API access and database bypass capabilities.
select
  role.rolname,
  role.rolcanlogin,
  role.rolinherit,
  role.rolsuper,
  role.rolcreatedb,
  role.rolcreaterole,
  role.rolreplication,
  role.rolbypassrls
from pg_roles role
where role.rolname in ('anon', 'authenticated', 'authenticator', 'service_role')
order by role.rolname;

-- 3) All non-system schemas, direct ACLs and effective API-role privileges.
select
  namespace.nspname as schema_name,
  pg_get_userbyid(namespace.nspowner) as owner_name,
  namespace.nspacl as direct_acl,
  has_schema_privilege('anon', namespace.oid, 'USAGE') as anon_usage,
  has_schema_privilege('anon', namespace.oid, 'CREATE') as anon_create,
  has_schema_privilege('authenticated', namespace.oid, 'USAGE') as authenticated_usage,
  has_schema_privilege('authenticated', namespace.oid, 'CREATE') as authenticated_create
from pg_namespace namespace
where namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname;

select
  namespace.nspname as schema_name,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor,
  acl.privilege_type,
  acl.is_grantable
from pg_namespace namespace
cross join lateral aclexplode(
  coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))
) as acl
where namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, grantee, acl.privilege_type;

-- 4) Inventory of tables, partitions, views, materialized views and foreign
-- tables. The API-exposed schema list must be compared with the setting above.
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  case relation.relkind
    when 'r' then 'table'
    when 'p' then 'partitioned table'
    when 'v' then 'view'
    when 'm' then 'materialized view'
    when 'f' then 'foreign table'
    else relation.relkind::text
  end as relation_type,
  pg_get_userbyid(relation.relowner) as owner_name,
  relation.relpersistence,
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as force_row_level_security,
  relation.relacl as direct_acl,
  has_table_privilege('anon', relation.oid, 'SELECT') as anon_select,
  has_table_privilege('authenticated', relation.oid, 'SELECT') as authenticated_select,
  case when relation.relkind in ('v', 'm')
    then pg_get_viewdef(relation.oid, true)
    else null
  end as view_definition
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
where relation.relkind in ('r', 'p', 'v', 'm', 'f')
  and namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, relation.relname;

-- 5) All columns and their types, nullability, defaults, identity and
-- generated-column metadata for the inventoried relations.
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  attribute.attnum as ordinal_position,
  attribute.attname as column_name,
  format_type(attribute.atttypid, attribute.atttypmod) as data_type,
  attribute.attnotnull as not_null,
  pg_get_expr(default_value.adbin, default_value.adrelid) as default_expression,
  attribute.attidentity as identity_kind,
  attribute.attgenerated as generated_kind,
  collation.collname as collation_name
from pg_attribute attribute
join pg_class relation on relation.oid = attribute.attrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
left join pg_attrdef default_value
  on default_value.adrelid = attribute.attrelid
 and default_value.adnum = attribute.attnum
left join pg_collation collation on collation.oid = attribute.attcollation
where relation.relkind in ('r', 'p', 'v', 'm', 'f')
  and attribute.attnum > 0
  and not attribute.attisdropped
  and namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, relation.relname, attribute.attnum;

-- 6) Primary keys, unique/check constraints, foreign keys and validation state.
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  constraint_info.conname as constraint_name,
  case constraint_info.contype
    when 'p' then 'PRIMARY KEY'
    when 'f' then 'FOREIGN KEY'
    when 'u' then 'UNIQUE'
    when 'c' then 'CHECK'
    when 'x' then 'EXCLUSION'
    else constraint_info.contype::text
  end as constraint_type,
  referenced_namespace.nspname as referenced_schema,
  referenced_relation.relname as referenced_relation,
  constraint_info.convalidated as validated,
  constraint_info.condeferrable as deferrable,
  constraint_info.condeferred as initially_deferred,
  pg_get_constraintdef(constraint_info.oid, true) as constraint_definition
from pg_constraint constraint_info
join pg_class relation on relation.oid = constraint_info.conrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
left join pg_class referenced_relation
  on referenced_relation.oid = constraint_info.confrelid
left join pg_namespace referenced_namespace
  on referenced_namespace.oid = referenced_relation.relnamespace
where namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, relation.relname, constraint_info.conname;

-- 7) User-created triggers and the security properties/source of each
-- trigger function.
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  trigger_info.tgname as trigger_name,
  trigger_info.tgenabled as enabled_state,
  pg_get_triggerdef(trigger_info.oid, true) as trigger_definition,
  function_namespace.nspname as function_schema,
  function_info.proname as function_name,
  pg_get_function_identity_arguments(function_info.oid) as function_arguments,
  pg_get_userbyid(function_info.proowner) as function_owner,
  function_info.prosecdef as security_definer,
  not function_info.prosecdef as security_invoker,
  function_info.proconfig as function_settings,
  pg_get_functiondef(function_info.oid) as function_definition
from pg_trigger trigger_info
join pg_class relation on relation.oid = trigger_info.tgrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
join pg_proc function_info on function_info.oid = trigger_info.tgfoid
join pg_namespace function_namespace on function_namespace.oid = function_info.pronamespace
where not trigger_info.tgisinternal
  and namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, relation.relname, trigger_info.tgname;

-- 8) Every RLS policy, without predicate fragment matching. Compare the full
-- USING and WITH CHECK expressions, roles, command and policy mode.
select
  policy.schemaname as schema_name,
  policy.tablename as relation_name,
  relation.relkind as relation_kind,
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as force_row_level_security,
  policy.policyname as policy_name,
  policy.permissive as policy_mode,
  policy.cmd as command,
  policy.roles,
  policy.qual as using_expression,
  policy.with_check as with_check_expression
from pg_policies policy
left join pg_class relation
  on relation.oid = to_regclass(format('%I.%I', policy.schemaname, policy.tablename))
order by policy.schemaname, policy.tablename, policy.policyname;

-- 9) Effective table/view/foreign-table privileges. These include PUBLIC and
-- inherited role grants for anon and authenticated.
with api_roles(role_name) as (
  values ('anon'::text), ('authenticated'::text)
),
relation_privileges(privilege_name) as (
  values
    ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text),
    ('TRUNCATE'::text), ('REFERENCES'::text), ('TRIGGER'::text), ('MAINTAIN'::text)
)
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  relation.relkind as relation_kind,
  api_roles.role_name,
  relation_privileges.privilege_name,
  case
    when relation_privileges.privilege_name = 'MAINTAIN'
     and current_setting('server_version_num')::integer < 170000 then null
    else has_table_privilege(
      api_roles.role_name,
      relation.oid,
      relation_privileges.privilege_name
    )
  end as effective_privilege
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
cross join api_roles
cross join relation_privileges
where relation.relkind in ('r', 'p', 'v', 'm', 'f')
  and namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, relation.relname, api_roles.role_name, relation_privileges.privilege_name;

-- 10) Explicit table/view/foreign-table ACL grants, including PUBLIC grants.
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor,
  acl.privilege_type,
  acl.is_grantable
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
cross join lateral aclexplode(relation.relacl) as acl
where relation.relkind in ('r', 'p', 'v', 'm', 'f')
  and namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, relation.relname, grantee, acl.privilege_type;

-- 11) Effective column privileges for anon/authenticated, including
-- privileges inherited through PUBLIC or role membership.
with api_roles(role_name) as (
  values ('anon'::text), ('authenticated'::text)
),
column_privileges(privilege_name) as (
  values ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('REFERENCES'::text)
)
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  attribute.attname as column_name,
  api_roles.role_name,
  column_privileges.privilege_name,
  has_column_privilege(
    api_roles.role_name,
    relation.oid,
    attribute.attname,
    column_privileges.privilege_name
  ) as effective_privilege
from pg_attribute attribute
join pg_class relation on relation.oid = attribute.attrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
cross join api_roles
cross join column_privileges
where relation.relkind in ('r', 'p', 'v', 'm', 'f')
  and attribute.attnum > 0
  and not attribute.attisdropped
  and namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, relation.relname, attribute.attnum, api_roles.role_name, column_privileges.privilege_name;

-- 12) Explicit column-level grants, including PUBLIC grants.
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  attribute.attname as column_name,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor,
  acl.privilege_type,
  acl.is_grantable
from pg_attribute attribute
join pg_class relation on relation.oid = attribute.attrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
cross join lateral aclexplode(attribute.attacl) as acl
where relation.relkind in ('r', 'p', 'v', 'm', 'f')
  and attribute.attnum > 0
  and not attribute.attisdropped
  and namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, relation.relname, attribute.attnum, grantee, acl.privilege_type;

-- 13) Effective sequence privileges for anon/authenticated.
with api_roles(role_name) as (
  values ('anon'::text), ('authenticated'::text)
),
sequence_privileges(privilege_name) as (
  values ('USAGE'::text), ('SELECT'::text), ('UPDATE'::text)
)
select
  namespace.nspname as schema_name,
  sequence.relname as sequence_name,
  pg_get_userbyid(sequence.relowner) as owner_name,
  api_roles.role_name,
  sequence_privileges.privilege_name,
  has_sequence_privilege(
    api_roles.role_name,
    sequence.oid,
    sequence_privileges.privilege_name
  ) as effective_privilege
from pg_class sequence
join pg_namespace namespace on namespace.oid = sequence.relnamespace
cross join api_roles
cross join sequence_privileges
where sequence.relkind = 'S'
  and namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, sequence.relname, api_roles.role_name, sequence_privileges.privilege_name;

-- 14) Direct role memberships. The effective privilege queries above account
-- for inherited memberships; this result exposes the membership paths.
select
  member_role.rolname as member_role,
  granted_role.rolname as granted_role,
  pg_get_userbyid(membership.grantor) as grantor,
  membership.admin_option,
  to_jsonb(membership) ->> 'inherit_option' as inherit_option,
  to_jsonb(membership) ->> 'set_option' as set_option
from pg_auth_members membership
join pg_roles member_role on member_role.oid = membership.member
join pg_roles granted_role on granted_role.oid = membership.roleid
order by member_role.rolname, granted_role.rolname;

-- 15) Altered default privileges for all object types, owners and schemas.
select
  pg_get_userbyid(default_acl.defaclrole) as object_owner,
  namespace.nspname as schema_name,
  default_acl.defaclobjtype as object_type_code,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor,
  acl.privilege_type,
  acl.is_grantable
from pg_default_acl default_acl
left join pg_namespace namespace on namespace.oid = default_acl.defaclnamespace
cross join lateral aclexplode(default_acl.defaclacl) as acl
order by object_owner, namespace.nspname, default_acl.defaclobjtype, grantee, acl.privilege_type;

-- 16) Every non-system function/procedure/aggregate/window routine, not only
-- known RPCs. Definitions are included for functions/procedures; owners must
-- review bodies for dynamic SQL and table writes. Effective EXECUTE includes
-- PUBLIC and inherited grants.
select
  namespace.nspname as schema_name,
  routine.proname as routine_name,
  routine.prokind as routine_kind,
  routine.oid::regprocedure as signature,
  pg_get_function_identity_arguments(routine.oid) as identity_arguments,
  pg_get_function_result(routine.oid) as result_type,
  pg_get_userbyid(routine.proowner) as owner_name,
  routine.prosecdef as security_definer,
  not routine.prosecdef as security_invoker,
  routine.proconfig as function_settings_proconfig,
  routine.provolatile as volatility,
  routine.proleakproof as leakproof,
  routine.proacl as direct_acl,
  has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_execute_effective,
  has_function_privilege('authenticated', routine.oid, 'EXECUTE') as authenticated_execute_effective,
  case when routine.prokind in ('f', 'p')
    then pg_get_functiondef(routine.oid)
    else null
  end as function_definition
from pg_proc routine
join pg_namespace namespace on namespace.oid = routine.pronamespace
where namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, routine.proname, routine.oid::regprocedure::text;

-- 17) Function/procedure EXECUTE ACLs, including default and PUBLIC grants.
select
  namespace.nspname as schema_name,
  routine.oid::regprocedure as signature,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor,
  acl.privilege_type,
  acl.is_grantable
from pg_proc routine
join pg_namespace namespace on namespace.oid = routine.pronamespace
cross join lateral aclexplode(
  coalesce(routine.proacl, acldefault('f', routine.proowner))
) as acl
where namespace.nspname <> 'information_schema'
  and left(namespace.nspname, 3) <> 'pg_'
order by namespace.nspname, routine.oid::regprocedure::text, grantee;

-- 18) All Storage buckets. JSON access keeps optional Supabase-version fields
-- observable without assuming their columns exist in every deployment.
select
  bucket.id,
  bucket.name,
  bucket.public,
  bucket.file_size_limit,
  bucket.allowed_mime_types,
  to_jsonb(bucket) ->> 'owner' as owner_metadata,
  to_jsonb(bucket) ->> 'created_at' as created_at_metadata,
  to_jsonb(bucket) ->> 'updated_at' as updated_at_metadata
from storage.buckets bucket
order by bucket.id;

-- 19) Storage object effective permissions for upload/insert, download/select,
-- update and delete. Pair these results with every storage.objects policy above.
with api_roles(role_name) as (
  values ('anon'::text), ('authenticated'::text)
),
storage_privileges(privilege_name) as (
  values ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)
)
select
  api_roles.role_name,
  storage_privileges.privilege_name,
  has_table_privilege(
    api_roles.role_name,
    'storage.objects',
    storage_privileges.privilege_name
  ) as effective_table_privilege
from api_roles
cross join storage_privileges
order by api_roles.role_name, storage_privileges.privilege_name;
