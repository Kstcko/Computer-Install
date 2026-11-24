# Phase 1.5 — Supabase Security Verification Audit

## Scope and evidence

This is a Local Workspace review of:

- `supabase/verification/20261124_read_only_mvp.sql`
- `supabase/migrations/20261124120000_read_only_mvp.sql`
- Local Schema v3.2 reference files in the workspace

No Supabase connection was made and no SQL was executed. Therefore, `PASS`
below means the local verification query statically covers the stated
inventory; it does not mean that Production passed the check. Production
results remain `NOT VERIFIED`.

The verification SQL contains SELECT-only statements and does not select
business rows. PostgreSQL execution and version-specific compatibility have
not been tested. Full function and view definitions may expose internal
implementation details; keep results in an authorized review context.

## 1. Schema Inventory

**Local coverage: PASS** — The verification SQL inventories server/PostgREST
settings, non-system schemas, tables and partitions, views, materialized views,
foreign tables, owners, RLS flags, columns/types/defaults/identity/generated
metadata, constraints including PK/FK definitions, and user-created triggers
with their function definitions.

**Production result: NOT VERIFIED** — No Production catalog results are
available. Compare every API-exposed schema and object to the complete v3.2
baseline; do not infer that a local baseline matches Production.

## 2. RLS Inventory

**Local coverage: PASS** — The query returns each policy's schema/table/name,
relation kind, RLS and FORCE RLS flags, permissive/restrictive mode, command,
roles, full `USING`, and full `WITH CHECK` expression. It does not use
predicate-fragment matching.

**Production result: NOT VERIFIED** — Policy definitions and table flags have
not been read from Production or compared with the baseline.

## 3. Grants Inventory

**Local coverage: PASS** — The query includes schema ACLs and effective
`anon`/`authenticated` schema privileges; effective relation and column
privileges; explicit relation and column ACLs; effective sequence
privileges; role memberships; altered default privileges; and function
EXECUTE ACLs and effective EXECUTE for `anon`/`authenticated`. The
PostgreSQL 17 `MAINTAIN` table privilege is version-gated and returns `NULL`
on older server versions.

**Production result: NOT VERIFIED** — No role, grant, membership, or default
privilege results are available. Confirm that the expected Supabase API roles
exist; otherwise the relevant privilege queries cannot establish a result.

## 4. Function Security Inventory

**Local coverage: PASS** — Every non-system routine is inventoried, not just
known RPCs, with signature, owner, security mode, function settings
(`proconfig`, including any configured `search_path`), volatility, leakproof
flag, ACL, effective API-role EXECUTE, and function definition for
functions/procedures. Aggregate and window routines receive metadata but do
not have `pg_get_functiondef` output in this query.

**Production result: NOT VERIFIED** — Production function owners, settings,
definitions, EXECUTE grants, and actual table access have not been checked.
Review routine bodies for dynamic SQL and data mutation; catalog metadata
alone does not prove a function is safe.

## 5. Storage Inventory

**Local coverage: PASS** — The query lists Storage buckets and their
public/private flag and available metadata, includes `storage.objects` RLS
policies through the complete policy inventory, and reports effective
`anon`/`authenticated` object-table SELECT/INSERT/UPDATE/DELETE grants.
Generic relation inventory also reports grants and RLS flags for Storage
relations.

**Production result: NOT VERIFIED** — Bucket configuration, object policies,
and effective permissions have not been read. If Storage relations are absent
or inaccessible, the Storage queries cannot complete and this section must
remain blocked rather than be treated as a pass.

## 6. Migration Preflight Coverage

**Status: BLOCKED** — The review-only migration now raises an exception at the
start of its preflight. It cannot reach its later DDL or grant changes unless
someone edits the hard lock. The old policy predicate fragment matching was
removed.

The remaining preflight is not a complete exact comparison of Production
schema, every policy expression, all grants, functions, and Storage rules.
Do not set the local approval flag to `true`, remove the guard, or execute the
migration. First obtain and review the authorized Production inventory, then
implement an exact, fail-closed comparison and obtain explicit owner approval.

## 7. Security Gaps

| Status | Gap |
|---|---|
| NOT VERIFIED | Production schema, policies, grants, function owners/definitions, and Storage configuration have no local evidence. |
| BLOCKED | Migration is deliberately hard-locked; its remaining checks are not a complete exact inventory comparison. |
| NOT VERIFIED | Verification SQL syntax and catalog-column compatibility have not been tested on the target PostgreSQL version. |
| NOT VERIFIED | Function bodies and policy expressions have not been semantically reviewed against Production behavior. |
| NOT VERIFIED | Any output from the verification SQL has not been collected or sanitized. |

## 8. Items Still NOT VERIFIED

- Production schema/object inventory versus v3.2
- Production RLS enabled/FORCE flags and every policy predicate
- Effective and explicit grants for `anon`, `authenticated`, and `PUBLIC`
- Function definitions, ownership, `search_path`, and EXECUTE exposure
- Storage buckets, privacy flags, policies, and effective object permissions
- The SQL's successful execution on the target Supabase PostgreSQL version
- Whether Read-only MVP access is enforced by Production RLS/grants, not merely
  by disabled frontend controls

## 9. Production Approval Checklist

**Status: BLOCKED — do not approve or apply the migration yet.**

1. An authorized owner runs the read-only verification SQL in the Production
   SQL Editor and retains results securely.
2. The owner confirms the returned API schema list and required roles are
   complete; any query error or missing inventory is a blocker.
3. Compare complete schema objects, columns, constraints, triggers, policies,
   grants, memberships, default privileges, function security, and Storage
   configuration with the approved v3.2 baseline.
4. Review full policy expressions and function bodies; resolve every
   unexpected or unverified result.
5. Test the verification SQL against the target PostgreSQL version in an
   authorized non-Production environment, without substituting that result
   for Production review.
6. Only after owner approval, revise the migration preflight to compare the
   reviewed Production inventory exactly and fail closed on missing evidence.
7. Obtain explicit approval before any Production migration. This audit did
   not execute SQL, modify Production, commit, push, or deploy.
