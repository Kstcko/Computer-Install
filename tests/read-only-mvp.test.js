import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertBusinessMutationDisabled } from '../src/mvp-mode.js';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('business mutations fail closed in the read-only MVP', () => {
  assert.throws(assertBusinessMutationDisabled, /Read-only MVP/);
});

test('non-work mutations stay disabled in the read-only MVP', async () => {
  const source = await readSource('js/tasks/task-store.js');
  const methods = [
    'markNotificationsRead',
    'bulkUpdate',
    'bulkDelete',
    'assignTechnician',
    'assignAssistant',
    'updateStatus'
  ];

  methods.forEach((name, index) => {
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `${name} method exists`);
    const nextMethod = methods
      .slice(index + 1)
      .map(nextName => source.indexOf(`async function ${nextName}(`, start + 1))
      .filter(position => position !== -1)
      .sort((first, second) => first - second)[0];
    const body = source.slice(start, nextMethod ?? source.length);
    const guard = body.indexOf('assertBusinessMutationDisabled();');
    assert.notEqual(guard, -1, `${name} must fail closed`);
    const databaseCall = body.search(/getSupabaseClient\(\)|\.from\(|\.rpc\(/);
    assert.ok(databaseCall === -1 || guard < databaseCall, `${name} guard must run before Supabase`);
  });
});

test('Work Management writes use scoped gates, permissions, and soft-delete RPCs', async () => {
  const source = await readSource('js/tasks/task-store.js');
  const methods = [
    ['createInstall', "requirePermission('tasks.create'"],
    ['updateInstall', "requirePermission('tasks.edit'"],
    ['addInstallItem', "requirePermission('tasks.create'"],
    ['updateInstallItem', "requirePermission('tasks.edit'"],
    ['softDeleteInstall', "requirePermission('tasks.delete'"],
    ['restoreInstall', "requirePermission('tasks.restore'"],
    ['restore', "requirePermission('tasks.restore'"],
    ['remove', "requirePermission('tasks.delete'"]
  ];

  methods.forEach(([name, permission]) => {
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `${name} method exists`);
    const end = source.indexOf('\nasync function ', start + 1);
    const body = source.slice(start, end === -1 ? source.length : end);
    const gateIndex = body.indexOf('assertWorkManagementEnabled();');
    const permissionIndex = body.indexOf(permission);
    const databaseCall = body.search(/getSupabaseClient\(\)|\.from\(|\.rpc\(/);
    assert.ok(gateIndex !== -1 && permissionIndex > gateIndex, `${name} requires its permission`);
    assert.ok(databaseCall === -1 || permissionIndex < databaseCall, `${name} checks permission before Supabase`);
    assert.doesNotMatch(body, /assertBusinessMutationDisabled\(\)/);
  });

  assert.match(source, /\.rpc\('create_install_with_items'/);
  assert.match(source, /\.rpc\('soft_delete_install_item'/);
  assert.match(source, /\.rpc\('soft_delete_install'/);
  assert.doesNotMatch(source, /\.delete\(/);
  const updateItemStart = source.indexOf('async function updateInstallItem(');
  const updateItemEnd = source.indexOf('\nasync function softDeleteInstall', updateItemStart);
  const updateItemBody = source.slice(updateItemStart, updateItemEnd);
  assert.match(updateItemBody, /priority: item\.priority/);
  assert.doesNotMatch(updateItemBody, /status\s*:/);
});

test('protected reads check the loaded permission before querying private tables', async () => {
  const [taskStore, siteUpdates, staff] = await Promise.all([
    readSource('js/tasks/task-store.js'),
    readSource('js/core/site-updates.js'),
    readSource('js/staff.js')
  ]);
  const assertBeforeQuery = (source, startMarker, endMarker, permission, queryMarker) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `${startMarker} exists`);
    const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
    assert.notEqual(end, -1, `${endMarker} exists`);
    const body = source.slice(start, end);
    const permissionIndex = body.indexOf(permission);
    const queryIndex = body.indexOf(queryMarker);
    assert.ok(permissionIndex !== -1 && queryIndex !== -1 && permissionIndex < queryIndex);
  };

  assertBeforeQuery(
    taskStore,
    'async function fetchTasks(',
    '\nfunction profileName',
    "requirePermission('tasks.view'",
    ".from('install_items')"
  );
  assertBeforeQuery(
    taskStore,
    'async function getById(',
    '\nasync function getTrash',
    "requirePermission('tasks.view'",
    ".from('install_items')"
  );
  assertBeforeQuery(
    taskStore,
    'async function getProfiles(',
    '\nasync function getTechnicians',
    "requirePermission('users.view'",
    ".from('profiles')"
  );
  assertBeforeQuery(
    taskStore,
    'async function getNotifications(',
    '\nasync function markNotificationsRead',
    "requirePermission('notifications.view'",
    ".from('notifications')"
  );
  assertBeforeQuery(
    siteUpdates,
    'async function getAll(',
    '\nasync function markRead',
    "permissions['site_updates.view']",
    ".from('site_updates')"
  );

  const staffGate = staff.indexOf("if (!currentPermissions['users.view'] || !currentPermissions['users.edit'])");
  const profilesQuery = staff.indexOf(".from('profiles')");
  const permissionsQuery = staff.indexOf(".from('role_permissions')");
  assert.ok(staffGate !== -1 && staffGate < profilesQuery && staffGate < permissionsQuery);
});

test('forgot-password request uses the shared client and a base-relative reset URL', async () => {
  const [loginPage, forgotPage, forgotScript, viteConfig] = await Promise.all([
    readSource('Login.html'),
    readSource('ForgotPassword.html'),
    readSource('js/forgot-password.js'),
    readSource('vite.config.js')
  ]);

  assert.match(loginPage, /href="ForgotPassword\.html">ลืมรหัสผ่าน\?/);
  assert.match(forgotPage, /type="email"[^>]*required/);
  assert.match(viteConfig, /forgotPassword: resolve\(root, 'ForgotPassword\.html'\)/);
  assert.match(forgotScript, /getSupabaseClient\(\)\.auth\.resetPasswordForEmail/);
  assert.match(forgotScript, /new URL\('ResetPassword\.html', window\.location\.href\)/);
  assert.match(forgotScript, /if \(submitting\) return/);
  assert.match(forgotPage, /หากอีเมลนี้มีบัญชี/);
  assert.doesNotMatch(forgotScript, /console\.(?:log|info|warn|error)\s*\(/);
});

test('password reset requires a recovery event and validates before updating', async () => {
  const [resetPage, resetScript, supabaseClient, auth] = await Promise.all([
    readSource('ResetPassword.html'),
    readSource('js/password-reset.js'),
    readSource('src/supabase.js'),
    readSource('js/core/auth.js')
  ]);

  assert.match(resetPage, /id="resetPasswordForm"[^>]*hidden/);
  assert.match(resetPage, /id="requestNewResetLink"[^>]*href="ForgotPassword\.html"[^>]*hidden/);
  assert.match(supabaseClient, /query\.has\('code'\)[\s\S]*flowType: getAuthFlowType\(\)/);
  assert.match(supabaseClient, /fragment\.has\('access_token'\)/);
  assert.match(supabaseClient, /return 'implicit'/);
  assert.match(resetScript, /event === 'PASSWORD_RECOVERY'/);
  assert.match(resetScript, /client\.auth\.getSession\(\)/);
  assert.match(resetScript, /window\.setTimeout\(resolve, 0\)/);
  assert.match(resetScript, /client\.auth\.getUser\(\)/);
  assert.match(resetScript, /searchParams\.set\('recovery', '1'\)/);
  assert.ok(resetScript.indexOf('client.auth.getUser()') < resetScript.indexOf('form.hidden = false'));
  assert.match(resetScript, /requestNewResetLink\.hidden = false/);
  assert.match(resetScript, /password\.length < 8 \|\| password\.length > 72/);
  assert.match(resetScript, /password !== confirmation/);
  assert.match(resetScript, /client\.auth\.updateUser\(\{ password \}\)/);
  assert.ok(
    resetScript.indexOf('client.auth.updateUser({ password })')
      < resetScript.indexOf("window.location.replace('Login.html?passwordReset=success')")
  );
  assert.match(resetScript, /if \(submitting\) return/);
  assert.doesNotMatch(resetScript, /signOut\s*\(/);
  assert.doesNotMatch(auth, /ResetPassword\.html/);
  assert.doesNotMatch(resetScript, /console\.(?:log|info|warn|error)\s*\(/);
});

test('Work Management UI uses scoped permissions and preserves other MVP mutation gates', async () => {
  const [main, report, profile, staff, siteUpdates, work, workUi, services, register] = await Promise.all([
    readSource('js/main.js'),
    readSource('js/install-report.js'),
    readSource('js/profile.js'),
    readSource('js/staff.js'),
    readSource('js/core/site-updates.js'),
    readSource('Work.html'),
    readSource('js/tasks/work-management-ui.js'),
    readSource('services.html'),
    readSource('Register.html')
  ]);

  assert.match(main, /initializeWorkManagement\(\)/);
  assert.ok(report.indexOf('if (MVP_READ_ONLY) {') < report.indexOf('storage.upload('));
  assert.ok(profile.indexOf('if (!MVP_READ_ONLY) {') < profile.indexOf('.update({'));
  assert.ok(staff.indexOf('if (!MVP_READ_ONLY) {') < staff.indexOf('SiteUpdates.publish('));
  ['markRead', 'markAllRead', 'publish'].forEach(name => {
    const start = siteUpdates.indexOf(`async function ${name}(`);
    const guard = siteUpdates.indexOf('assertBusinessMutationDisabled();', start);
    const nextMutation = siteUpdates.indexOf('\nasync function ', start + 1);
    const bodyEnd = nextMutation === -1 ? siteUpdates.length : nextMutation;
    assert.ok(start !== -1 && guard > start && guard < bodyEnd, `${name} must fail closed`);
  });
  assert.match(work, /id="taskDetailView"/);
  assert.match(work, /id="installItemEditorTemplate"/);
  assert.match(work, /id="jobNumber"[^>]*required/);
  assert.match(workUi, /AppDialogs\.confirm/);
  assert.match(workUi, /TaskStore\.softDeleteInstall/);
  assert.match(workUi, /TaskStore\.remove/);
  assert.match(services, /id="createTaskLink"[^>]*hidden/);
  assert.match(services, /id="trashInstallList"/);
  assert.doesNotMatch(services, /Read-only MVP/);
  assert.doesNotMatch(register, /<form|signUp\s*\(/i);
});
