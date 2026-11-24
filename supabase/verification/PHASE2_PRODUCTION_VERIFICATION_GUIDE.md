# PHASE 2 — Supabase Production Read-only Verification Guide

## 1. Purpose and safety boundary

This guide is for an authorized system owner reviewing the Supabase Production
project. It describes how to run and assess
[`20261124_read_only_mvp.sql`](./20261124_read_only_mvp.sql).

**No Production connection or SQL execution was performed while preparing this
guide.** The verification SQL has 20 statements: sections 1–19, with section 3
containing two separate SELECT statements. Run only the verification file,
one statement at a time. Do not run a migration, schema file, bootstrap file,
or any SQL that is not explicitly identified below as a verification SELECT.

The statements are read-only by their SQL operation, but the Supabase SQL
Editor may connect with a highly privileged database role. Read-only text is
not a substitute for checking the selected project, controlling who can run
queries, and handling the returned security metadata carefully.

## 2. Statement review and side-effect assessment

All 20 statements begin with `SELECT` or `WITH ... SELECT`. They read
PostgreSQL catalogs, privilege metadata, PostgREST settings, and
`storage.buckets` metadata. None contains DML or DDL. They do not select
business-table rows.

The SQL calls catalog/metadata and privilege-inspection functions, including
`current_setting`, `has_*_privilege`, `pg_get_*`, `aclexplode`, `acldefault`,
`to_regclass`, `to_regprocedure`, `format_type`, `pg_get_userbyid`, and
`to_jsonb`. These inspect settings, resolve object identifiers, format
definitions, expand ACL metadata, or evaluate privileges; they do not write
database state.

Most importantly, sections 7 and 16 **retrieve function definitions; they do
not invoke those user-defined functions**. The query does not call
`change_install_item_status()`, `purge_expired_install_items()`, or any other
application RPC. The SQL does not prove that the retrieved functions are
safe; reviewers must inspect their definitions and grants.

No query is absolutely risk-free to share: the main risk is disclosure of
security configuration or implementation details in the result, not a
database write.

## 3. Before opening the SQL Editor

1. Obtain the system owner's authorization to inspect the named Production
   project. Do not use credentials or a project URL supplied through an
   untrusted channel.
2. Sign in to the Supabase Dashboard using an individually authorized
   account and verify the project name and project reference in the dashboard
   before opening SQL Editor. Stop if the project identity is unclear.
3. Use a private, access-controlled workstation and a reviewer authorized to
   see database security metadata. Do not screen-share raw results or paste
   them into chat, tickets, public logs, or source files.
4. Open the local verification SQL as text first. Confirm the file path and
   inspect the statement you intend to run. Do not run
   `Computer-Install-Supabase-Schema-v3.2-Clean.sql`,
   `Computer-Install-Supabase-Developer-Bootstrap-v3.2.sql`, the Read-only
   MVP migration, or other schema/bootstrap files.
5. In SQL Editor, paste and run one statement at a time. Do not select or run
   the entire contents if you have not checked every statement. Keep each
   result tied to its query number and record any error without editing the
   query in Production.
6. If a query errors, returns a truncated result, or requires an unexpected
   permission, mark it `NOT VERIFIED` or `BLOCKED`; do not infer a pass and
   do not “fix” the Production database to make it run.

The SQL Editor may retain query history and results. Treat its history,
exports, screenshots, and copied result sets as confidential.

## 4. Query order and risk classification

Risk below is about **result sensitivity**, not mutability. All listed
statements are read-only, but some results should be restricted to security
reviewers. Run in this order so that project identity and structure are
established before reviewing detailed authorization and function source.
Complete all sections needed for approval; a low-risk result is not a
substitute for a later required query.

| Order | Query section | What it returns | Handling |
|---|---|---|---|
| 1 | 1 | PostgreSQL version and PostgREST exposed-schema/search-path settings | Low-to-moderate sensitivity. A missing setting is not proof of no exposed schema; confirm configuration with the owner. |
| 2 | 2 | Supabase API role attributes, including superuser and RLS-bypass flags | Restricted security metadata. Do not share role/security configuration publicly. |
| 3 | 4 | Relation inventory, RLS flags, owners, ACLs, and view definitions | Moderate-to-high sensitivity. View definitions can expose internal logic. |
| 4 | 5 | Column names/types/defaults and identity/generated metadata | Moderate sensitivity. Defaults and column names may reveal internal design; contains no row values. |
| 5 | 6 | PK/unique/check/FK definitions and validation state | Moderate sensitivity. Constraint expressions can reveal business rules. |
| 6 | 3a, 3b | Schema privileges, direct ACLs, and effective API-role schema privileges | Restricted security metadata. Keep raw ACLs private. |
| 7 | 8 | Every RLS policy, full predicates, commands, roles, and RLS flags | High sensitivity. Full predicates reveal authorization logic; share only sanitized findings. |
| 8 | 9–13 | Effective/direct relation, column, and sequence privileges | Restricted security metadata. Retain raw results privately for comparison. |
| 9 | 14–15 | Role memberships and altered default privileges | High sensitivity. Role membership can reveal privileged access paths. |
| 10 | 18–19 | Storage bucket configuration and effective object-table privileges | High sensitivity. Bucket names and optional owner metadata may be identifying. |
| 11 | 7 | Trigger definitions and trigger-function source | High sensitivity. Source can contain implementation details or unsafe hard-coded values. |
| 12 | 16–17 | All non-system routine definitions/metadata and function EXECUTE ACLs | Highest sensitivity. Definitions may contain internal identifiers or accidentally embedded credentials. Restrict to authorized security reviewers. |

Section 3 contains two statements: **3a** lists schema ownership and
effective `anon`/`authenticated` privileges; **3b** expands schema ACL entries.
The verification file's section numbers are the authoritative query IDs.

### Results that may contain personal or confidential information

The verification SQL does not query user/profile/business row values. It may
still return:

- Role names, owners, grantors, membership paths, and bucket-owner metadata
  (sections 2–3, 4, 10, 12, 14–15, 18).
- Column names or defaults that identify personal-data fields or encode
  internal values (sections 5–6).
- View definitions, policies, trigger/function source, and ACLs that expose
  internal architecture or authorization logic (sections 4, 7–8, 16–17).
- Hard-coded identifiers, email addresses, or credentials if any were
  mistakenly embedded in a definition. This is a possibility to inspect for,
  not a claim that such values exist.

Keep complete, unredacted output only in the owner's approved restricted
location. For wider reporting, record query ID, status, and a concise
sanitized discrepancy; remove personal identifiers, object paths, function
source, and credential-like strings. If a credential is found, stop sharing
the result and follow the organization's secret-incident/rotation procedure.

## 5. Supabase SQL Editor procedure

1. In the verified Production project, open **SQL Editor** and start a new
   query. Do not use the dashboard's migration/apply workflow.
2. From the local verification file, copy one complete statement including
   its CTE if it starts with `WITH`; do not copy only part of a statement.
3. Confirm that the statement is from section 1–19 of the verification file.
   The file contains 20 statements because section 3 has two.
4. Run that one statement. Review whether it completed without truncation or
   error, then save the result in the restricted evidence location under the
   matching query ID. Do not export/share more columns or rows than needed.
5. Repeat in the order in section 4. Record errors, empty results, and
   missing/unavailable schemas as evidence, not as success.
6. Compare outputs to the approved local v3.2 baseline as described below.
7. Have a second authorized reviewer verify all security-sensitive
   differences and sign the results table.

Do not add `SET ROLE`, `set_config`, `EXPLAIN ANALYZE`, calls to application
functions, or ad hoc SQL to the Production verification session. Do not rely
on `ROLLBACK` as a safety mechanism: only run the supplied read-only
statements.

## 6. Compare Production with Schema v3.2

Use the local
`Computer-Install-Supabase-Schema-v3.2-Clean.sql` as a **reference document
only**. Do not execute it. The separate Developer Bootstrap and migration
files are not comparison scripts and must not be run as part of this audit.
If the approved v3.2 baseline has changed, obtain the owner's version and
record its version/hash before comparing.

Compare in this order:

1. **API surface:** Compare section 1's exposed schemas/search path to the
   schema inventory in section 4. Every API-exposed object must be accounted
   for; investigate unexpected views, materialized views, foreign tables, or
   schemas.
2. **Schema objects:** Compare sections 4–7 with every relevant table,
   partition, view, column, default, constraint, FK, trigger, and trigger
   function in v3.2. Compare exact names, types, nullability, definitions,
   owner, and validation/enabled state. Do not treat matching table names as
   proof that columns or constraints match.
3. **RLS:** For every RLS-enabled table and `storage.objects`, compare the
   complete set of policies—not just required policy names. Compare command,
   role list, permissive/restrictive mode, full `USING`, full `WITH CHECK`,
   RLS enabled, and FORCE RLS flags. An additional permissive policy can
   broaden access; do not mark it harmless without review.
4. **Privileges:** Compare schema, relation, column, sequence, routine, and
   default ACLs. Review effective `anon` and `authenticated` results as well
   as explicit grants and membership paths. Include `PUBLIC`; an absent
   direct grant does not prove an effective privilege is absent.
5. **Functions:** Compare every non-system function/procedure, not only
   known RPC names. Check signature, owner, `SECURITY DEFINER` versus
   invoker, configured `search_path`, full definition, volatility, and
   effective/direct EXECUTE. Specifically locate
   `purge_expired_install_items()` and every mutation RPC. Do not execute a
   function as part of the comparison.
6. **Storage:** Compare bucket ID/name/public flag and available settings;
   compare all `storage.objects` policies and effective SELECT/INSERT/UPDATE/
   DELETE privileges. A policy name match alone is insufficient.
7. Record each difference as one of: expected and approved, unexpected
   security-relevant drift, or not comparable. Any unexplained difference or
   incomplete output blocks migration approval.

Treat null/empty results carefully. For example, an empty table result can
mean no matching rows, an RLS-filtered result, or a query/filter issue; it is
not automatically proof that an object or privilege is absent. The
verification query's version-gated `MAINTAIN` result is `NULL` on PostgreSQL
versions before 17 and is not a failed grant check.

## 7. Test `anon` and `authenticated` separately from SQL Editor

SQL Editor runs under its database connection role and does not reproduce an
API request's JWT claims or `auth.uid()`. Do not simulate API users in the
Production SQL Editor with `SET ROLE` or `set_config`. Test the API using
read-only HTTP `GET` requests and separate credentials:

- **Anonymous:** use only the project's publishable/anon API key, with no
  user access token. This should exercise the API's `anon` role.
- **Authenticated:** use an approved, non-privileged test user's short-lived
  access token in the `Authorization: Bearer` header plus the publishable
  API key. This should exercise `authenticated` and the test user's actual
  JWT claims. If role-specific behavior is in scope, repeat only with
  separately approved test accounts for the roles under review.

The following Windows PowerShell examples are templates only. Set variables
in a private local session; never paste real keys or tokens into this guide,
tickets, logs, or screenshots. Replace `<verified_table>` and
`<verified_non_sensitive_column>` only after confirming the exposed table and
column from the approved schema inventory. Send `GET` only:

```powershell
# Anonymous: omit Authorization so the request has no user JWT.
$base = $env:SUPABASE_URL.TrimEnd('/')
$headers = @{ apikey = $env:SUPABASE_PUBLISHABLE_KEY }
$uri = "$base/rest/v1/<verified_table>?select=<verified_non_sensitive_column>&limit=1"
$response = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -UseBasicParsing
$rows = @($response.Content | ConvertFrom-Json)
"HTTP $($response.StatusCode); rows: $($rows.Count)"
```

```powershell
# Authenticated: use an approved test user's short-lived access token.
$base = $env:SUPABASE_URL.TrimEnd('/')
$headers = @{
  apikey = $env:SUPABASE_PUBLISHABLE_KEY
  Authorization = "Bearer $env:SUPABASE_TEST_ACCESS_TOKEN"
}
$uri = "$base/rest/v1/<verified_table>?select=<verified_non_sensitive_column>&limit=1"
$response = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -UseBasicParsing
$rows = @($response.Content | ConvertFrom-Json)
"HTTP $($response.StatusCode); rows: $($rows.Count)"
```

Use only a non-sensitive selected column and the smallest practical limit.
Do not save or share returned row values. A `200` with an empty array can be
the expected result of RLS or simply mean no matching rows; compare with the
policy's expected behavior and, if necessary, use an owner-approved,
non-sensitive record. A `401`/`403` is not automatically a pass either:
confirm the request role, endpoint, and expected policy outcome. Record
HTTP status, whether the response was empty/non-empty, query/table identifier,
test-account role (not user identity), and expected-vs-observed result.

Do not send `POST`, `PATCH`, `PUT`, or `DELETE`; do not call RPC endpoints;
do not upload, update, or delete Storage objects. This guide's API checks are
read-only and do not test mutation denial by attempting a mutation. Assess
mutation exposure from grants/RPC ACLs and the reviewed RLS/policies; any
separate mutation-denial test requires an isolated non-Production project and
explicit approval.

## 8. Production verification record

Complete one row per statement. Store the raw result reference only in an
owner-approved restricted location; do not put raw output in this table.

| Query ID | Run timestamp (UTC) | Status | Evidence reference (restricted) | Sanitized finding / issue | Reviewer |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3a |  |  |  |  |  |
| 3b |  |  |  |  |  |
| 4 |  |  |  |  |  |
| 5 |  |  |  |  |  |
| 6 |  |  |  |  |  |
| 7 |  |  |  |  |  |
| 8 |  |  |  |  |  |
| 9 |  |  |  |  |  |
| 10 |  |  |  |  |  |
| 11 |  |  |  |  |  |
| 12 |  |  |  |  |  |
| 13 |  |  |  |  |  |
| 14 |  |  |  |  |  |
| 15 |  |  |  |  |  |
| 16 |  |  |  |  |  |
| 17 |  |  |  |  |  |
| 18 |  |  |  |  |  |
| 19 |  |  |  |  |  |

Record anonymous and authenticated API checks separately, without access
tokens, user IDs, or returned row values:

| API role tested | Table/endpoint reference | Expected policy outcome | HTTP status / empty result | Status | Reviewer |
|---|---|---|---|---|---|
| `anon` |  |  |  |  |  |
| `authenticated` |  |  |  |  |  |
| Additional approved role, if required |  |  |  |  |  |

## 9. Status definitions and release gate

- **PASS** — The query/API test completed, evidence is complete, the result
  was compared to the approved baseline and intended policy, and no
  unexplained security-relevant discrepancy remains. A successful SQL
  execution alone is not a pass.
- **FAIL** — Evidence confirms an unintended privilege, missing/disabled
  RLS, unsafe policy/function exposure, public/private Storage mismatch, or
  another verified security requirement violation.
- **NOT VERIFIED** — The query/test was not run, errored, was truncated, the
  result was not retained/reviewed, the expected behavior is unknown, or the
  available evidence cannot establish the claim.
- **BLOCKED** — A prerequisite is absent or a discrepancy prevents a safe
  decision, such as wrong/uncertain project, missing required schema/role,
  unsupported or inaccessible metadata, incomplete inventory, or an
  unresolved FAIL.

Production migration approval remains **BLOCKED** if any required query is
not `PASS`, any result is incomplete, any security-relevant difference is
unexplained, or the separate `anon`/`authenticated` checks are missing.
This verification guide does not authorize or execute a migration.
