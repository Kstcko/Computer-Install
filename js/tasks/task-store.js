import { getSupabaseClient } from '../../src/supabase.js';
import {
  assertBusinessMutationDisabled,
  assertWorkManagementEnabled
} from '../../src/mvp-mode.js';
import { AppAuth } from '../core/auth.js';

const pageSize = 500;
const permissionCodes = [
  'tasks.view',
  'tasks.create',
  'tasks.edit',
  'tasks.delete',
  'tasks.change_status',
  'users.view',
  'users.create',
  'users.edit',
  'users.delete',
  'tasks.assign',
  'tasks.restore',
  'reports.submit',
  'reports.view',
  'notifications.view',
  'notifications.manage',
  'site_updates.view',
  'site_updates.manage',
  'site_updates.files.manage'
];
const taskColumns = [
  'id',
  'install_id',
  'department_id',
  'requester_user_id',
  'asset_identifier',
  'detail',
  'status',
  'priority',
  'technician_user_id',
  'technician_name_snapshot',
  'assistant_user_id',
  'assistant_name_snapshot',
  'opened_at',
  'due_at',
  'deleted_at',
  'created_at',
  'installs!inner(job_number,job_name,owner_user_id,owner_name)',
  'departments(department_name)',
  'requester:profiles!install_items_requester_user_id_fkey(first_name,last_name)',
  'technician:profiles!install_items_technician_user_id_fkey(first_name,last_name)',
  'assistant:profiles!install_items_assistant_user_id_fkey(first_name,last_name)'
].join(',');

let permissions = {};
let initialization;
let initializationUserId = null;

function getUser() {
  const user = AppAuth.getCurrentUser();
  if (!user) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  return user;
}

function requirePermission(permission, message) {
  if (!hasPermission(permission)) throw new Error(message);
}

async function initialize() {
  const user = await AppAuth.initialize();
  if (!user) {
    permissions = {};
    initialization = null;
    initializationUserId = null;
    throw new Error('กรุณาเข้าสู่ระบบก่อนดูข้อมูลงาน');
  }

  if (!initialization || initializationUserId !== user.userId) {
    initializationUserId = user.userId;
    initialization = (async () => {
      const { data, error } = await getSupabaseClient()
        .from('role_permissions')
        .select('permission_code,is_allowed')
        .eq('role_code', user.role);
      if (error) throw error;

      const rows = new Map((data || []).map(row => [row.permission_code, row.is_allowed]));
      const missing = permissionCodes.filter(code => !rows.has(code));
      if (missing.length) {
        throw new Error(`ข้อมูลสิทธิ์ไม่ครบตาม Schema v3.2: ${missing.join(', ')}`);
      }
      permissions = Object.fromEntries(permissionCodes.map(code => [code, rows.get(code) === true]));
    })().catch(error => {
      initialization = null;
      initializationUserId = null;
      permissions = {};
      throw error;
    });
  }
  return initialization;
}

async function fetchTasks(deleted) {
  await initialize();
  requirePermission('tasks.view', 'Role ของคุณไม่มีสิทธิ์ดูรายการงาน');
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = getSupabaseClient()
      .from('install_items')
      .select(taskColumns)
      .order('opened_at', { ascending: false })
      .range(from, from + pageSize - 1);
    query = deleted
      ? query.not('deleted_at', 'is', null)
      : query.is('deleted_at', null);

    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows.map(mapTask);
}

function profileName(profile) {
  return profile
    ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
    : '';
}

function mapTask(row) {
  const install = row.installs;
  if (!install) {
    throw new Error('ไม่พบข้อมูล Job Header ของรายการติดตั้งนี้');
  }
  const requester = profileName(row.requester);
  const technician = profileName(row.technician) || row.technician_name_snapshot || '';
  const assistant = profileName(row.assistant) || row.assistant_name_snapshot || '';
  const departmentName = row.departments?.department_name || '';
  const deletedAt = row.deleted_at;

  return {
    id: row.id,
    installId: row.install_id,
    taskId: install.job_number,
    jobName: install.job_name || '',
    assetIdentifier: row.asset_identifier || '',
    department: requester || departmentName,
    requester,
    departmentId: row.department_id || '',
    departmentName,
    requesterId: row.requester_user_id || '',
    detail: row.detail,
    date: row.opened_at,
    dueAt: row.due_at || '',
    owner: install.owner_name || '',
    technician,
    technicianId: row.technician_user_id || '',
    installationAssistant: assistant,
    installationAssistantId: row.assistant_user_id || '',
    priority: row.priority,
    status: row.status,
    deletedAt,
    installDeletedAt: install.deleted_at || null,
    expiresAt: deletedAt
      ? new Date(new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : '',
    createdAt: row.created_at
  };
}

async function getAll() {
  return fetchTasks(false);
}

async function getById(id) {
  await initialize();
  requirePermission('tasks.view', 'Role ของคุณไม่มีสิทธิ์ดูรายการงาน');
  const { data, error } = await getSupabaseClient()
    .from('install_items')
    .select(taskColumns)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapTask(data) : null;
}

async function getTrash() {
  await initialize();
  if (!hasPermission('tasks.delete')) throw new Error('Role ของคุณไม่มีสิทธิ์ดูถังขยะ');
  const [items, installs] = await Promise.all([
    fetchTasks(true),
    getArchivedInstalls()
  ]);
  return { items, installs };
}

async function getInstallById(id) {
  await initialize();
  requirePermission('tasks.view', 'Role ของคุณไม่มีสิทธิ์ดูรายละเอียดงาน');
  const { data, error } = await getSupabaseClient()
    .from('installs')
    .select([
      'id,job_number,job_name,owner_user_id,owner_name,deleted_at,created_at',
      'install_items(',
      'id,install_id,department_id,requester_user_id,asset_identifier,detail,',
      'status,priority,technician_user_id,technician_name_snapshot,',
      'assistant_user_id,assistant_name_snapshot,opened_at,due_at,deleted_at,created_at,',
      'departments(department_name),',
      'requester:profiles!install_items_requester_user_id_fkey(first_name,last_name),',
      'technician:profiles!install_items_technician_user_id_fkey(first_name,last_name),',
      'assistant:profiles!install_items_assistant_user_id_fkey(first_name,last_name)',
      ')'
    ].join(''))
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    jobNumber: data.job_number,
    jobName: data.job_name || '',
    ownerUserId: data.owner_user_id || '',
    ownerName: data.owner_name || '',
    deletedAt: data.deleted_at,
    createdAt: data.created_at,
    items: (data.install_items || [])
      .filter(item => !item.deleted_at)
      .map(item => mapTask({
        ...item,
        installs: {
          job_number: data.job_number,
          job_name: data.job_name,
          owner_user_id: data.owner_user_id,
          owner_name: data.owner_name,
          deleted_at: data.deleted_at
        }
      }))
      .sort((first, second) => String(first.date).localeCompare(String(second.date)))
  };
}

async function getArchivedInstalls() {
  await initialize();
  if (!hasPermission('tasks.delete')) throw new Error('Role ของคุณไม่มีสิทธิ์ดูงานที่เก็บถาวร');
  const { data, error } = await getSupabaseClient()
    .from('installs')
    .select('id,job_number,job_name,deleted_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getDepartments() {
  await initialize();
  requirePermission('tasks.view', 'Role ของคุณไม่มีสิทธิ์ดูแผนก');
  const { data, error } = await getSupabaseClient()
    .from('departments')
    .select('id,department_name')
    .order('department_name');
  if (error) throw error;
  return (data || []).map(department => ({
    id: department.id,
    name: department.department_name
  }));
}

async function getProfiles(roleCodes = null) {
  await initialize();
  requirePermission('users.view', 'Role ของคุณไม่มีสิทธิ์ดูข้อมูลผู้ใช้');
  let query = getSupabaseClient()
    .from('profiles')
    .select('id,first_name,last_name,role_code,is_active')
    .eq('is_active', true)
    .order('first_name');
  if (roleCodes) query = query.in('role_code', roleCodes);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(profile => ({
    id: profile.id,
    name: profileName(profile),
    role: profile.role_code
  }));
}

async function getTechnicians() {
  await initialize();
  if (!hasPermission('tasks.assign')) return [];
  return getProfiles(['technician']);
}

async function getAssistants() {
  await initialize();
  if (!hasPermission('tasks.assign')) return [];
  return getProfiles(['technician', 'intern']);
}

async function getRequesters() {
  return getProfiles();
}

async function getPermissions() {
  await initialize();
  return { ...permissions };
}

async function getNotifications() {
  await initialize();
  requirePermission('notifications.view', 'Role ของคุณไม่มีสิทธิ์ดูการแจ้งเตือน');
  const user = getUser();
  const { data, error } = await getSupabaseClient()
    .from('notifications')
    .select('id,title,message,event_type,is_read,created_at,install_id,install_item_id')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const notifications = (data || []).map(row => ({
    id: row.id,
    title: row.title,
    message: row.message,
    eventType: row.event_type,
    isRead: row.is_read,
    createdAt: row.created_at,
    installId: row.install_id,
    installItemId: row.install_item_id
  }));
  return {
    notifications,
    unreadCount: notifications.filter(notification => !notification.isRead).length
  };
}

async function markNotificationsRead(notificationId = null) {
  assertBusinessMutationDisabled();
  await initialize();
  const user = getUser();
  let query = getSupabaseClient()
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user.userId)
    .eq('is_read', false);
  if (notificationId) query = query.eq('id', notificationId);
  const { error } = await query;
  if (error) throw error;
}

function throwWriteError(error) {
  if (error?.code === '23505') {
    throw new Error('เลขที่งานซ้ำ หรือ Serial Number นี้มีอยู่แล้วในงานเดียวกัน');
  }
  throw error;
}

async function createInstall(install) {
  assertWorkManagementEnabled();
  await initialize();
  requirePermission('tasks.create', 'Role ของคุณไม่มีสิทธิ์สร้างงาน');
  const { data, error } = await getSupabaseClient().rpc('create_install_with_items', {
    p_job_number: install.jobNumber,
    p_job_name: install.jobName || null,
    p_owner_name: install.ownerName || null,
    p_items: install.items.map(item => ({
      department_id: item.departmentId || null,
      asset_identifier: item.assetIdentifier || null,
      detail: item.detail,
      priority: item.priority || 'medium',
      opened_at: item.openedAt || null,
      due_at: item.dueAt || null
    }))
  });
  if (error) throwWriteError(error);
  if (typeof data !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
    throw new Error('สร้างงานแล้วแต่ไม่ได้รับรหัสงานจาก Supabase');
  }
  return data;
}

async function updateInstall(id, install) {
  assertWorkManagementEnabled();
  await initialize();
  requirePermission('tasks.edit', 'Role ของคุณไม่มีสิทธิ์แก้ไขงาน');
  const { data, error } = await getSupabaseClient()
    .from('installs')
    .update({
      job_number: install.jobNumber.trim(),
      job_name: install.jobName.trim() || null,
      owner_name: install.ownerName.trim() || null
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error) throwWriteError(error);
  if (!data) throw new Error('ไม่พบงานที่ต้องการแก้ไข หรือไม่มีสิทธิ์เข้าถึง');
}

async function addInstallItem(installId, item) {
  assertWorkManagementEnabled();
  await initialize();
  requirePermission('tasks.create', 'Role ของคุณไม่มีสิทธิ์เพิ่มรายการงานย่อย');
  const { data, error } = await getSupabaseClient()
    .from('install_items')
    .insert({
      install_id: installId,
      department_id: item.departmentId || null,
      asset_identifier: item.assetIdentifier || null,
      detail: item.detail,
      priority: item.priority || 'medium',
      opened_at: item.openedAt || null,
      due_at: item.dueAt || null
    })
    .select('id')
    .maybeSingle();
  if (error) throwWriteError(error);
  if (!data) throw new Error('เพิ่มรายการงานย่อยไม่สำเร็จ');
}

async function updateInstallItem(id, item) {
  assertWorkManagementEnabled();
  await initialize();
  requirePermission('tasks.edit', 'Role ของคุณไม่มีสิทธิ์แก้ไขรายการงานย่อย');
  const { data, error } = await getSupabaseClient()
    .from('install_items')
    .update({
      department_id: item.departmentId || null,
      asset_identifier: item.assetIdentifier || null,
      detail: item.detail,
      priority: item.priority,
      opened_at: item.openedAt,
      due_at: item.dueAt || null
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error) throwWriteError(error);
  if (!data) throw new Error('ไม่พบรายการงานย่อย หรือไม่มีสิทธิ์เข้าถึง');
}

async function softDeleteInstall(id) {
  assertWorkManagementEnabled();
  await initialize();
  requirePermission('tasks.delete', 'Role ของคุณไม่มีสิทธิ์เก็บถาวรงาน');
  const { error } = await getSupabaseClient().rpc('soft_delete_install', {
    p_install_id: id
  });
  if (error) throw error;
}

async function restoreInstall(id) {
  assertWorkManagementEnabled();
  await initialize();
  requirePermission('tasks.restore', 'Role ของคุณไม่มีสิทธิ์กู้คืนงาน');
  const { error } = await getSupabaseClient().rpc('restore_install', {
    p_install_id: id
  });
  if (error) throw error;
}

async function bulkUpdate() {
  assertBusinessMutationDisabled();
}

async function bulkDelete() {
  assertBusinessMutationDisabled();
}

async function restore(id) {
  assertWorkManagementEnabled();
  await initialize();
  requirePermission('tasks.restore', 'Role ของคุณไม่มีสิทธิ์กู้คืนรายการงาน');
  const { error } = await getSupabaseClient().rpc('restore_install_item', {
    p_item_id: id
  });
  if (error) throw error;
}

async function assignTechnician(id, technicianId) {
  assertBusinessMutationDisabled();
  await initialize();
  if (!hasPermission('tasks.assign')) throw new Error('Role ของคุณไม่มีสิทธิ์มอบหมายช่าง');
  const { error } = await getSupabaseClient()
    .from('install_items')
    .update({ technician_user_id: technicianId || null })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw error;
}

async function assignAssistant(id, assistantId) {
  assertBusinessMutationDisabled();
  await initialize();
  if (!hasPermission('tasks.assign')) throw new Error('Role ของคุณไม่มีสิทธิ์มอบหมายช่างช่วย');
  const { error } = await getSupabaseClient()
    .from('install_items')
    .update({ assistant_user_id: assistantId || null })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw error;
}

async function remove(id) {
  assertWorkManagementEnabled();
  await initialize();
  requirePermission('tasks.delete', 'Role ของคุณไม่มีสิทธิ์ลบรายการงาน');
  const { error } = await getSupabaseClient().rpc('soft_delete_install_item', {
    p_item_id: id
  });
  if (error) throw error;
}

async function updateStatus(id, status) {
  assertBusinessMutationDisabled();
  await initialize();
  const client = getSupabaseClient();
  const { data: item, error: itemError } = await client
    .from('install_items')
    .select('status')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item) throw new Error('ไม่พบรายการงานที่ต้องการเปลี่ยนสถานะ');

  const statusOrder = ['waiting', 'progress', 'done'];
  if (!statusOrder.includes(status)) throw new Error('สถานะงานไม่ถูกต้อง');
  if (statusOrder.indexOf(status) < statusOrder.indexOf(item.status)) {
    throw new Error('ไม่อนุญาตให้ย้อนสถานะงาน');
  }
  if (item.status === 'progress' && status === 'done') {
    throw new Error(
      'ยังเปลี่ยนจากกำลังดำเนินการเป็นเสร็จไม่ได้: ต้องพัฒนาและติดตั้ง Edge Function สำหรับยืนยันรหัสผ่านและออก Re-auth Ticket ก่อน'
    );
  }

  const { error } = await client.rpc('change_install_item_status', {
    p_item_id: id,
    p_new_status: status,
    p_reauth_ticket: null
  });
  if (error) throw error;
}

function hasPermission(permission) {
  return permissions[permission] === true;
}

export const TaskStore = {
  supportsJobCreation: true,
  supportsBulkOperations: false,
  supportsReauthForDone: false,
  getAll,
  getById,
  getInstallById,
  getTrash,
  getDepartments,
  getTechnicians,
  getAssistants,
  getRequesters,
  getPermissions,
  hasPermission,
  getNotifications,
  markNotificationsRead,
  createInstall,
  updateInstall,
  addInstallItem,
  updateInstallItem,
  softDeleteInstall,
  restoreInstall,
  bulkUpdate,
  bulkDelete,
  restore,
  assignTechnician,
  assignAssistant,
  remove,
  updateStatus
};
