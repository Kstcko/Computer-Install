import { AppAuth } from '../core/auth.js';
import { AppDialogs } from '../core/dialogs.js';
import { TaskStore } from './task-store.js';

const statusNames = {
  waiting: 'รอดำเนินการ',
  progress: 'กำลังดำเนินการ',
  done: 'เสร็จแล้ว'
};

const priorityNames = {
  low: 'ต่ำ',
  medium: 'ปกติ',
  high: 'สูง'
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

const localDate = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const formatDate = value => {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('th-TH');
};

const formatDateTime = value => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
};

const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value || '-';
};

function itemEditorValues(editor) {
  const value = name => editor.querySelector(`[data-field="${name}"]`).value.trim();
  return {
    departmentId: value('departmentId'),
    assetIdentifier: value('assetIdentifier'),
    detail: value('detail'),
    priority: value('priority'),
    openedAt: value('openedAt'),
    dueAt: value('dueAt')
  };
}

function setFormBusy(form, busy) {
  form.setAttribute('aria-busy', String(busy));
  form.querySelectorAll('button, input, select, textarea').forEach(control => {
    control.disabled = busy || control.dataset.modeDisabled === 'true';
  });
}

function setSectionDisabled(section, disabled) {
  section?.querySelectorAll('button, input, select, textarea').forEach(control => {
    control.dataset.modeDisabled = String(disabled);
    control.disabled = disabled;
  });
}

function setMessage(element, message) {
  if (element) element.textContent = message || '';
}

function createItemEditor(template, departments, initial = {}, index = 1, allowRemove = false) {
  const editor = template.content.firstElementChild.cloneNode(true);
  const itemNumber = editor.querySelector('[data-item-number]');
  const removeButton = editor.querySelector('[data-remove-item]');
  if (itemNumber) itemNumber.textContent = String(index);
  if (removeButton) removeButton.hidden = !allowRemove;

  const department = editor.querySelector('[data-field="departmentId"]');
  if (department) {
    departments.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      department.append(option);
    });
    if (initial.departmentId && !departments.some(item => item.id === initial.departmentId)) {
      const option = document.createElement('option');
      option.value = initial.departmentId;
      option.textContent = 'แผนกเดิม';
      department.append(option);
    }
  }

  editor.querySelectorAll('[data-field]').forEach(field => {
    const name = field.dataset.field;
    const id = `install-item-${index}-${name}`;
    field.id = id;
    editor.querySelector(`[data-label="${name}"]`)?.setAttribute('for', id);
    if (initial[name] !== undefined && initial[name] !== null) {
      field.value = initial[name];
    }
  });
  const openedAt = editor.querySelector('[data-field="openedAt"]');
  const dueAt = editor.querySelector('[data-field="dueAt"]');
  if (openedAt && !openedAt.value) openedAt.value = localDate();
  if (dueAt && openedAt) {
    dueAt.min = openedAt.value;
    openedAt.addEventListener('change', () => {
      dueAt.min = openedAt.value;
    });
  }
  return editor;
}

function renumberEditors(list) {
  list.querySelectorAll('[data-install-item]').forEach((editor, index) => {
    const itemIndex = index + 1;
    const number = editor.querySelector('[data-item-number]');
    if (number) number.textContent = String(itemIndex);
    editor.querySelectorAll('[data-field]').forEach(field => {
      const id = `install-item-${itemIndex}-${field.dataset.field}`;
      field.id = id;
      editor.querySelector(`[data-label="${field.dataset.field}"]`)?.setAttribute('for', id);
    });
  });
}

function updateRemoveButtons(list) {
  const canRemove = list.querySelectorAll('[data-install-item]').length > 1;
  list.querySelectorAll('[data-remove-item]').forEach(button => {
    button.hidden = !canRemove;
  });
}

async function showInstall(installId) {
  const detailView = document.getElementById('taskDetailView');
  const detailMessage = document.getElementById('taskDetailMessage');
  const form = document.getElementById('taskForm');
  if (!detailView || !detailMessage || !form) return;

  form.hidden = true;
  detailView.hidden = false;
  detailView.setAttribute('aria-busy', 'true');
  setMessage(detailMessage, 'กำลังโหลดรายละเอียดงาน...');
  try {
    let install = await TaskStore.getInstallById(installId);
    if (!install) {
      const item = await TaskStore.getById(installId);
      if (item) install = await TaskStore.getInstallById(item.installId);
    }
    if (!install) {
      setMessage(detailMessage, 'ไม่พบงานนี้ หรือไม่มีสิทธิ์เข้าถึงข้อมูล');
      return;
    }

    const permissions = await TaskStore.getPermissions();
    const archived = Boolean(install.deletedAt);
    setText('taskDetailJobNumber', install.jobNumber);
    setText('taskDetailJobName', install.jobName);
    setText('taskDetailOwner', install.ownerName);
    setText('taskDetailCreated', formatDateTime(install.createdAt));
    setMessage(detailMessage, archived
      ? 'งานหลักนี้ถูกเก็บถาวร รายการงานและประวัติยังคงอยู่'
      : '');
    const pageTitle = document.getElementById('formTitle');
    if (pageTitle) pageTitle.textContent = `งาน ${install.jobNumber}`;
    const description = document.getElementById('taskFormDescription');
    if (description) description.textContent = 'รายละเอียดงานหลักและรายการงานย่อย';
    document.title = `งาน ${install.jobNumber} | Install`;

    const editLink = document.getElementById('editInstallLink');
    if (editLink) {
      editLink.href = `Work.html?editInstall=${encodeURIComponent(install.id)}`;
      editLink.hidden = archived || !permissions['tasks.edit'];
    }
    const addLink = document.getElementById('addInstallItemLink');
    if (addLink) {
      addLink.href = `Work.html?addItem=${encodeURIComponent(install.id)}`;
      addLink.hidden = archived || !permissions['tasks.create'];
    }
    const archiveButton = document.getElementById('archiveInstallButton');
    if (archiveButton) archiveButton.hidden = archived || !permissions['tasks.delete'];
    const restoreButton = document.getElementById('restoreInstallButton');
    if (restoreButton) restoreButton.hidden = !archived || !permissions['tasks.restore'];

    const list = document.getElementById('installItemsList');
    if (list) {
      list.innerHTML = install.items.length
        ? install.items.map(item => `
            <article class="work-item-card">
              <header>
                <h3>${escapeHtml(item.assetIdentifier || 'รายการงาน')}</h3>
                <span class="work-status status-${escapeHtml(item.status)}">${escapeHtml(statusNames[item.status] || item.status)}</span>
              </header>
              <dl class="work-item-details">
                <div><dt>แผนก</dt><dd>${escapeHtml(item.departmentName || '-')}</dd></div>
                <div><dt>ผู้แจ้ง</dt><dd>${escapeHtml(item.requester || '-')}</dd></div>
                <div><dt>วันที่แจ้ง</dt><dd>${escapeHtml(formatDate(item.date))}</dd></div>
                <div><dt>วันที่จัดส่ง</dt><dd>${escapeHtml(formatDate(item.dueAt))}</dd></div>
                <div><dt>ช่าง</dt><dd>${escapeHtml(item.technician || '-')}</dd></div>
                <div><dt>ช่างช่วย</dt><dd>${escapeHtml(item.installationAssistant || '-')}</dd></div>
                <div><dt>ความสำคัญ</dt><dd>${escapeHtml(priorityNames[item.priority] || item.priority || '-')}</dd></div>
              </dl>
              <p class="work-item-description">${escapeHtml(item.detail || '-')}</p>
              ${item.deletedAt
                ? '<p class="work-item-deleted">รายการนี้ถูกลบแบบ Soft Delete</p>'
                : `<div class="work-item-actions">
                    ${permissions['tasks.edit'] && !archived
                      ? `<a class="btn light-button" href="Work.html?editItem=${encodeURIComponent(item.id)}">แก้ไขรายการ</a>`
                      : ''}
                    ${permissions['tasks.delete'] && !archived
                      ? `<button class="btn btn-danger" type="button" data-delete-item="${escapeHtml(item.id)}">ลบรายการ</button>`
                      : ''}
                  </div>`}
            </article>
          `).join('')
        : '<p class="work-items-empty">ไม่มีรายการงานย่อยที่ใช้งานอยู่</p>';
    }

    const listRoot = document.getElementById('installItemsList');
    if (listRoot && !listRoot.dataset.bound) {
      listRoot.dataset.bound = 'true';
      listRoot.addEventListener('click', async event => {
        const button = event.target.closest('[data-delete-item]');
        if (!button) return;
        if (!await AppDialogs.confirm('ยืนยันลบรายการงานย่อยนี้หรือไม่? ระบบจะใช้ Soft Delete และเก็บประวัติไว้', {
          title: 'ยืนยันลบรายการงาน',
          confirmText: 'ลบรายการ',
          tone: 'danger'
        })) return;
        button.disabled = true;
        try {
          await TaskStore.remove(button.dataset.deleteItem);
          await showInstall(installId);
        } catch (error) {
          await AppDialogs.alert(error.message || 'ลบรายการงานไม่สำเร็จ', {
            title: 'ลบรายการไม่สำเร็จ',
            tone: 'danger'
          });
          button.disabled = false;
        }
      });
    }

    if (archiveButton && !archiveButton.dataset.bound) {
      archiveButton.dataset.bound = 'true';
      archiveButton.addEventListener('click', async () => {
        if (!await AppDialogs.confirm(
          `ยืนยันเก็บถาวรงาน ${install.jobNumber} หรือไม่? ระบบจะเก็บรายการงานย่อยและประวัติไว้`,
          { title: 'เก็บถาวรงานหลัก', confirmText: 'เก็บถาวร', tone: 'danger' }
        )) return;
        archiveButton.disabled = true;
        try {
          await TaskStore.softDeleteInstall(installId);
          window.location.href = 'services.html#trash';
        } catch (error) {
          await AppDialogs.alert(error.message || 'เก็บถาวรงานไม่สำเร็จ', {
            title: 'เก็บถาวรไม่สำเร็จ',
            tone: 'danger'
          });
          archiveButton.disabled = false;
        }
      });
    }

    if (restoreButton && !restoreButton.dataset.bound) {
      restoreButton.dataset.bound = 'true';
      restoreButton.addEventListener('click', async () => {
        if (!await AppDialogs.confirm(`ยืนยันกู้คืนงาน ${install.jobNumber} หรือไม่?`, {
          title: 'กู้คืนงานหลัก',
          confirmText: 'กู้คืนงาน'
        })) return;
        restoreButton.disabled = true;
        try {
          await TaskStore.restoreInstall(installId);
          await showInstall(installId);
        } catch (error) {
          await AppDialogs.alert(error.message || 'กู้คืนงานไม่สำเร็จ', {
            title: 'กู้คืนไม่สำเร็จ',
            tone: 'danger'
          });
          restoreButton.disabled = false;
        }
      });
    }
  } catch (error) {
    setMessage(detailMessage, error.message || 'โหลดรายละเอียดงานไม่สำเร็จ');
  } finally {
    detailView.removeAttribute('aria-busy');
  }
}

async function prepareForm(parameters) {
  const form = document.getElementById('taskForm');
  const template = document.getElementById('installItemEditorTemplate');
  const itemList = document.getElementById('installItemEditorList');
  const message = document.getElementById('taskFormMessage');
  if (!form || !template || !itemList || !message) return;
  form.hidden = false;
  setFormBusy(form, true);

  try {
    const permissions = await TaskStore.getPermissions();
    const editInstallId = parameters.get('editInstall');
    const editItemId = parameters.get('editItem');
    const addItemId = parameters.get('addItem');
    const mode = editInstallId ? 'editInstall'
      : editItemId ? 'editItem'
        : addItemId ? 'addItem' : 'createInstall';
    const requiredPermission = mode === 'editInstall' || mode === 'editItem'
      ? 'tasks.edit'
      : 'tasks.create';
    if (!permissions[requiredPermission]) {
      throw new Error('Role ของคุณไม่มีสิทธิ์ดำเนินการนี้');
    }

    const departments = await TaskStore.getDepartments();
    const currentUser = AppAuth.getCurrentUser();
    const profileName = `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim();
    const headerFields = document.getElementById('installHeaderFields');
    const summary = document.getElementById('installSummary');
    const summaryTitle = document.getElementById('installSummaryTitle');
    const itemSection = document.getElementById('installItemEditors');
    const addButton = document.getElementById('addInstallItemButton');
    const submitButton = document.getElementById('saveButton');
    const editorTitle = document.getElementById('itemEditorTitle');
    let install = null;
    let item = null;

    if (mode === 'editInstall') {
      install = await TaskStore.getInstallById(editInstallId);
      if (!install) throw new Error('ไม่พบงานที่ต้องการแก้ไข');
      if (install.deletedAt) throw new Error('ไม่สามารถแก้ไขงานที่เก็บถาวรแล้ว');
      document.getElementById('jobNumber').value = install.jobNumber || '';
      document.getElementById('jobName').value = install.jobName || '';
      document.getElementById('ownerName').value = install.ownerName || '';
      headerFields.hidden = false;
      itemSection.hidden = true;
      setSectionDisabled(headerFields, false);
      setSectionDisabled(itemSection, true);
      summary.hidden = true;
      if (submitButton) submitButton.textContent = 'บันทึกการแก้ไข';
      document.getElementById('formTitle').textContent = 'แก้ไขงานหลัก';
    } else if (mode === 'editItem') {
      item = await TaskStore.getById(editItemId);
      if (!item) throw new Error('ไม่พบรายการงานที่ต้องการแก้ไข');
      install = await TaskStore.getInstallById(item.installId);
      if (!install || install.deletedAt) throw new Error('ไม่สามารถแก้ไขรายการของงานที่เก็บถาวรแล้ว');
      headerFields.hidden = true;
      summary.hidden = false;
      setSectionDisabled(headerFields, true);
      setSectionDisabled(itemSection, false);
      summaryTitle.textContent = `${install.jobNumber} — ${install.jobName || 'ไม่มีชื่องาน'}`;
      if (addButton) addButton.hidden = true;
      if (editorTitle) editorTitle.textContent = 'แก้ไขรายการงานย่อย';
      if (submitButton) submitButton.textContent = 'บันทึกการแก้ไข';
      document.getElementById('formTitle').textContent = 'แก้ไขรายการงานย่อย';
    } else if (mode === 'addItem') {
      install = await TaskStore.getInstallById(addItemId);
      if (!install || install.deletedAt) throw new Error('ไม่พบงาน หรือไม่สามารถเพิ่มรายการในงานที่เก็บถาวรแล้ว');
      headerFields.hidden = true;
      summary.hidden = false;
      setSectionDisabled(headerFields, true);
      setSectionDisabled(itemSection, false);
      summaryTitle.textContent = `${install.jobNumber} — ${install.jobName || 'ไม่มีชื่องาน'}`;
      if (addButton) addButton.hidden = true;
      if (editorTitle) editorTitle.textContent = 'เพิ่มรายการงานย่อย';
      if (submitButton) submitButton.textContent = 'เพิ่มรายการ';
      document.getElementById('formTitle').textContent = 'เพิ่มรายการงานย่อย';
    } else {
      headerFields.hidden = false;
      itemSection.hidden = false;
      summary.hidden = true;
      setSectionDisabled(headerFields, false);
      setSectionDisabled(itemSection, false);
      document.getElementById('ownerName').value = profileName;
      if (addButton) addButton.hidden = false;
      if (submitButton) submitButton.textContent = 'สร้างงาน';
      document.getElementById('formTitle').textContent = 'สร้างงานติดตั้ง';
    }

    const initialItem = item
      ? {
          departmentId: item.departmentId,
          assetIdentifier: item.assetIdentifier,
          detail: item.detail,
          priority: item.priority,
          openedAt: item.date,
          dueAt: item.dueAt
        }
      : { departmentId: currentUser?.departmentId || '' };
    itemList.replaceChildren(createItemEditor(
      template,
      departments,
      initialItem,
      1,
      mode === 'createInstall'
    ));
    const removeButtons = itemList.querySelectorAll('[data-remove-item]');
    removeButtons.forEach(button => {
      button.hidden = mode !== 'createInstall' || itemList.querySelectorAll('[data-install-item]').length <= 1;
    });

    if (addButton && !addButton.dataset.bound) {
      addButton.dataset.bound = 'true';
      addButton.addEventListener('click', () => {
        const nextIndex = itemList.querySelectorAll('[data-install-item]').length + 1;
        itemList.append(createItemEditor(
          template,
          departments,
          { departmentId: currentUser?.departmentId || '' },
          nextIndex,
          true
        ));
        itemList.querySelectorAll('[data-remove-item]').forEach(button => {
          if (!button.dataset.bound) {
            button.dataset.bound = 'true';
            button.addEventListener('click', () => {
              button.closest('[data-install-item]').remove();
              renumberEditors(itemList);
              updateRemoveButtons(itemList);
            });
          }
        });
        updateRemoveButtons(itemList);
      });
    }
    itemList.querySelectorAll('[data-remove-item]').forEach(button => {
      if (!button.dataset.bound) {
        button.dataset.bound = 'true';
        button.addEventListener('click', () => {
          button.closest('[data-install-item]').remove();
          renumberEditors(itemList);
          updateRemoveButtons(itemList);
        });
      }
    });

    const pageDescription = document.getElementById('taskFormDescription');
    if (pageDescription) {
      pageDescription.textContent = mode === 'createInstall'
        ? 'ระบุข้อมูลงานหลักและเพิ่มรายการงานย่อยได้หลายรายการ'
        : 'แก้ไขเฉพาะข้อมูลที่ได้รับอนุญาต โดยไม่เปลี่ยนสถานะหรือผู้รับผิดชอบ';
    }
    document.title = `${document.getElementById('formTitle').textContent} | Install`;

    form.addEventListener('submit', async event => {
      event.preventDefault();
      setMessage(message, '');
      if (!form.reportValidity()) return;
      const items = [...itemList.querySelectorAll('[data-install-item]')].map(itemEditorValues);
      if (items.some(entry => !entry.detail)) {
        setMessage(message, 'กรุณาระบุรายละเอียดของรายการงานย่อย');
        return;
      }
      if (items.some(entry => entry.dueAt && entry.openedAt && entry.dueAt < entry.openedAt)) {
        setMessage(message, 'วันที่จัดส่งต้องไม่อยู่ก่อนวันที่แจ้ง');
        return;
      }
      if (mode === 'createInstall' && items.length === 0) {
        setMessage(message, 'กรุณาเพิ่มรายการงานย่อยอย่างน้อย 1 รายการ');
        return;
      }
      const jobNumber = document.getElementById('jobNumber').value.trim();
      if (mode === 'createInstall' || mode === 'editInstall') {
        if (!jobNumber) {
          document.getElementById('jobNumber').focus();
          setMessage(message, 'กรุณาระบุเลขที่งาน');
          return;
        }
      }

      setFormBusy(form, true);
      try {
        if (mode === 'createInstall') {
          await TaskStore.createInstall({
            jobNumber,
            jobName: document.getElementById('jobName').value.trim(),
            ownerName: document.getElementById('ownerName').value.trim(),
            items
          });
          window.location.href = 'services.html';
          return;
        }
        if (mode === 'editInstall') {
          await TaskStore.updateInstall(editInstallId, {
            jobNumber,
            jobName: document.getElementById('jobName').value,
            ownerName: document.getElementById('ownerName').value
          });
          window.location.href = `Work.html?view=${encodeURIComponent(editInstallId)}`;
          return;
        }
        if (mode === 'addItem') {
          await TaskStore.addInstallItem(addItemId, items[0]);
          window.location.href = `Work.html?view=${encodeURIComponent(addItemId)}`;
          return;
        }
        await TaskStore.updateInstallItem(editItemId, items[0]);
        window.location.href = `Work.html?view=${encodeURIComponent(install.id)}`;
      } catch (error) {
        setMessage(message, error.message || 'บันทึกงานไม่สำเร็จ');
        setFormBusy(form, false);
      }
    });
    setMessage(message, '');
    setFormBusy(form, false);
  } catch (error) {
    setMessage(message, error.message || 'เตรียมแบบฟอร์มไม่สำเร็จ');
    setFormBusy(form, false);
  }
}

export async function initializeWorkManagement() {
  const form = document.getElementById('taskForm');
  if (!form) return;
  const parameters = new URLSearchParams(window.location.search);
  const viewId = parameters.get('view');
  const detailView = document.getElementById('taskDetailView');
  if (viewId && detailView) {
    await showInstall(viewId);
    return;
  }
  await prepareForm(parameters);
}
