import { getSupabaseClient } from '../src/supabase.js';
import { MVP_READ_ONLY } from '../src/mvp-mode.js';
import { AppAuth } from './core/auth.js';
import { SiteUpdates } from './core/site-updates.js';
import { TaskStore } from './tasks/task-store.js';

const roleLabels = {
  admin: 'Admin',
  developer: 'Developer',
  technician: 'ช่าง',
  intern: 'นักศึกษาฝึกงาน'
};
const permissionLabels = {
  'tasks.view': 'ดูรายการงาน',
  'tasks.create': 'เพิ่มงาน',
  'tasks.edit': 'แก้ไขงาน',
  'tasks.delete': 'ลบงาน',
  'tasks.change_status': 'เปลี่ยนสถานะงาน',
  'users.view': 'ดูข้อมูลผู้ใช้',
  'users.create': 'สร้างบัญชี',
  'users.edit': 'จัดการผู้ใช้และสิทธิ์',
  'users.delete': 'ลบบัญชี',
  'tasks.assign': 'มอบหมายงาน',
  'tasks.restore': 'กู้คืนงาน',
  'reports.submit': 'ส่ง Install Report',
  'reports.view': 'ดู Install Report',
  'notifications.view': 'ดูการแจ้งเตือน',
  'notifications.manage': 'จัดการการแจ้งเตือน',
  'site_updates.view': 'ดูประกาศ',
  'site_updates.manage': 'จัดการประกาศ',
  'site_updates.files.manage': 'จัดการไฟล์ประกาศ'
};

document.addEventListener('DOMContentLoaded', async () => {
  const staffList = document.getElementById('staffList');
  const staffCount = document.getElementById('staffCount');
  const staffStatus = document.getElementById('staffStatus');
  const staffMessage = document.getElementById('staffMessage');
  const searchInput = document.getElementById('staffSearch');
  const roleFilter = document.getElementById('roleFilter');
  const permissionRole = document.getElementById('permissionRole');
  const permissionNote = document.getElementById('permissionNote');
  const permissionOptions = document.querySelector('.st-perm-options');
  const savePermissionsButton = document.getElementById('savePermissionsButton');
  const addEmployeeButton = document.getElementById('openAddEmployee');
  const siteUpdatePanel = document.getElementById('siteUpdatePanel');
  const siteUpdateFileStatus = document.getElementById('siteUpdateFileStatus');
  const siteUpdateFileList = document.getElementById('siteUpdateFileList');
  const siteUpdateForm = document.getElementById('siteUpdateForm');
  const siteUpdateMessage = document.getElementById('siteUpdateMessage');
  const publishSiteUpdateButton = document.getElementById('publishSiteUpdate');
  const refreshSiteChangesButton = document.getElementById('refreshSiteChanges');
  let users = [];
  let permissionsByRole = {};

  try {
    await AppAuth.initialize();
  } catch (error) {
    staffMessage.textContent = error.message || 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ';
    [savePermissionsButton, addEmployeeButton, publishSiteUpdateButton, refreshSiteChangesButton]
      .forEach(button => { button.disabled = true; });
    return;
  }

  const currentUser = AppAuth.getCurrentUser();
  if (!currentUser) {
    window.location.replace(`Login.html?returnTo=${encodeURIComponent('Staff.html')}`);
    return;
  }
  if (!['admin', 'developer'].includes(currentUser.role)) {
    staffMessage.textContent = 'หน้านี้จำกัดสิทธิ์สำหรับ Admin และ Developer';
    return;
  }

  let currentPermissions;
  try {
    currentPermissions = await TaskStore.getPermissions();
  } catch (error) {
    staffMessage.textContent = error.message || 'โหลดสิทธิ์ผู้ใช้ไม่สำเร็จ';
    return;
  }
  if (!currentPermissions['users.view'] || !currentPermissions['users.edit']) {
    staffMessage.textContent = 'Role ของคุณไม่มีสิทธิ์ดูข้อมูลพนักงานและสิทธิ์ของระบบ';
    return;
  }

  addEmployeeButton.disabled = true;
  addEmployeeButton.title = 'ต้องติดตั้ง Edge Function สำหรับจัดการ Supabase Auth Users ก่อน';
  document.getElementById('addEmployeeDialog').hidden = true;
  document.getElementById('resetEmployeePasswordDialog').hidden = true;
  document.getElementById('developerVisibilityPanel').hidden = true;
  document.getElementById('permissionPanel').hidden = false;
  siteUpdatePanel.hidden = false;
  refreshSiteChangesButton.disabled = true;
  savePermissionsButton.disabled = true;
  if (MVP_READ_ONLY) {
    siteUpdateForm.hidden = true;
    publishSiteUpdateButton.disabled = true;
    document.getElementById('siteUpdateReadOnlyNotice').hidden = false;
  }
  staffMessage.textContent =
    'แสดงข้อมูลแบบอ่านอย่างเดียว: การสร้าง/ลบบัญชี, เปลี่ยน Role และรหัสผ่านต้องมี Edge Function ที่ยังไม่ได้ติดตั้ง';

  const formatDate = value => {
    if (!value) return 'ไม่ระบุ';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'ไม่ระบุ' : date.toLocaleDateString('th-TH');
  };

  const renderUsers = () => {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const selectedRole = roleFilter.value;
    const filteredUsers = users.filter(user => {
      const searchable = [user.firstName, user.lastName, user.email, user.phone]
        .join(' ')
        .toLocaleLowerCase();
      return (!query || searchable.includes(query))
        && (!selectedRole || user.role === selectedRole);
    });

    staffList.replaceChildren();
    staffCount.textContent = String(filteredUsers.length);
    staffStatus.textContent = `จากทั้งหมด ${users.length} บัญชี`;
    if (!filteredUsers.length) {
      const empty = document.createElement('p');
      empty.className = 'staff-empty';
      empty.textContent = 'ไม่พบพนักงานตามเงื่อนไขที่เลือก';
      staffList.append(empty);
      return;
    }

    filteredUsers.forEach(user => {
      const card = document.createElement('article');
      card.className = 'staff-card';
      const header = document.createElement('div');
      header.className = 'staff-card-header';
      const identity = document.createElement('div');
      identity.className = 'staff-identity';
      const name = document.createElement('h2');
      name.textContent = `${user.firstName} ${user.lastName}`.trim() || 'ผู้ใช้งาน';
      const email = document.createElement('span');
      email.className = 'staff-email';
      email.textContent = user.email || 'ไม่ระบุอีเมล';
      identity.append(name, email);
      const badge = document.createElement('span');
      badge.className = 'staff-role-badge';
      badge.textContent = roleLabels[user.role] || `Role ไม่อยู่ใน Schema v3.2 (${user.role})`;
      header.append(identity, badge);

      const details = document.createElement('div');
      details.className = 'staff-details';
      for (const [label, value] of [
        ['เบอร์โทรศัพท์', user.phone],
        ['วันที่สร้างบัญชี', formatDate(user.createdAt)],
        ['สถานะ', user.isActive ? 'ใช้งาน' : 'ปิดใช้งาน']
      ]) {
        const detail = document.createElement('div');
        detail.className = 'staff-detail';
        const heading = document.createElement('span');
        heading.textContent = label;
        detail.append(heading, document.createTextNode(value || 'ไม่ระบุ'));
        details.append(detail);
      }
      card.append(header, details);
      staffList.append(card);
    });
  };

  const loadUsers = async () => {
    staffMessage.textContent = 'กำลังโหลดข้อมูลพนักงาน...';
    staffList.setAttribute('aria-busy', 'true');
    try {
      const { data, error } = await getSupabaseClient()
        .from('profiles')
        .select('id,first_name,last_name,email,phone,role_code,is_active,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      users = (data || []).map(profile => ({
        userId: profile.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        email: profile.email,
        phone: profile.phone,
        role: profile.role_code,
        isActive: profile.is_active,
        createdAt: profile.created_at
      }));
      renderUsers();
      staffMessage.textContent =
        'ข้อมูลบัญชีอ่านได้จาก Supabase; การเปลี่ยนบัญชีต้องพัฒนา Edge Function ก่อน';
    } catch (error) {
      staffList.replaceChildren();
      staffCount.textContent = '0';
      staffStatus.textContent = '';
      staffMessage.textContent = error.message || 'โหลดข้อมูลพนักงานไม่สำเร็จ';
    } finally {
      staffList.removeAttribute('aria-busy');
    }
  };

  const renderPermissions = () => {
    const role = permissionRole.value;
    const permissions = permissionsByRole[role];
    if (!permissions) return;
    permissionOptions.replaceChildren();
    Object.entries(permissionLabels).forEach(([code, label]) => {
      const wrapper = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.permission = code;
      checkbox.checked = permissions[code] === true;
      checkbox.disabled = true;
      wrapper.append(checkbox, document.createTextNode(label));
      permissionOptions.append(wrapper);
    });
    permissionNote.textContent =
      'ตารางสิทธิ์เป็นแบบอ่านอย่างเดียว; การแก้ไขต้องมีการอนุมัติและ hardening RLS ในฐานข้อมูล';
  };

  const loadPermissions = async () => {
    try {
      const { data, error } = await getSupabaseClient()
        .from('role_permissions')
        .select('role_code,permission_code,is_allowed');
      if (error) throw error;
      permissionsByRole = Object.fromEntries(
        ['admin', 'developer', 'technician', 'intern'].map(role => [
          role,
          Object.fromEntries(
            (data || [])
              .filter(row => row.role_code === role)
              .map(row => [row.permission_code, row.is_allowed])
          )
        ])
      );
      renderPermissions();
    } catch (error) {
      permissionNote.textContent = error.message || 'โหลดตารางสิทธิ์ไม่สำเร็จ';
    }
  };

  const loadPendingSiteChanges = async () => {
    siteUpdateFileList.replaceChildren();
    try {
      await SiteUpdates.getPendingChanges();
    } catch (error) {
      siteUpdateFileStatus.textContent = error.message;
    }
  };

  searchInput.addEventListener('input', renderUsers);
  roleFilter.addEventListener('change', renderUsers);
  permissionRole.addEventListener('change', renderPermissions);
  if (!MVP_READ_ONLY) {
    refreshSiteChangesButton.addEventListener('click', loadPendingSiteChanges);
    siteUpdateForm.addEventListener('submit', async event => {
      event.preventDefault();
      siteUpdateMessage.textContent = '';
      publishSiteUpdateButton.disabled = true;
      try {
        const formData = new FormData(siteUpdateForm);
        const result = await SiteUpdates.publish({
          title: formData.get('title'),
          summary: formData.get('summary')
        });
        siteUpdateForm.reset();
        siteUpdateMessage.textContent =
          `${result.message} (ประกาศนี้ไม่มีรายการไฟล์เปลี่ยนแปลง; การสแกนไฟล์ใช้ PHP เดิม)`;
      } catch (error) {
        siteUpdateMessage.textContent = error.message || 'เผยแพร่ประกาศไม่สำเร็จ';
      } finally {
        publishSiteUpdateButton.disabled = false;
      }
    });
  }

  permissionRole.value = currentUser.role;
  siteUpdateFileStatus.textContent =
    'การตรวจไฟล์เปลี่ยนแปลงเดิมต้องใช้ PHP อ่าน filesystem; ใช้ไม่ได้บน GitHub Pages';
  await Promise.all([loadUsers(), loadPermissions()]);
});
