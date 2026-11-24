const TaskStore = (() => {
  const endpoint = 'api/tasks.php';
  let initialization;
  let permissions = {};

  async function request(action, data = {}) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data })
      });
    } catch (error) {
      throw new Error('เชื่อมต่อระบบงานไม่ได้ กรุณาตรวจสอบเซิร์ฟเวอร์และลองใหม่');
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error('เซิร์ฟเวอร์ส่งข้อมูลไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ');
    }
    if (!response.ok) {
      throw new Error(result.message || 'ดำเนินการกับรายการงานไม่สำเร็จ');
    }
    return result;
  }

  async function initialize() {
    if (!initialization) {
      initialization = (async () => {
        const permissionResult = await request('permissions');
        if (!permissionResult.permissions || typeof permissionResult.permissions !== 'object') {
          throw new Error('ข้อมูลสิทธิ์การใช้งานจากเซิร์ฟเวอร์ไม่ถูกต้อง');
        }
        permissions = permissionResult.permissions;
      })().catch((error) => {
        initialization = null;
        throw error;
      });
    }
    return initialization;
  }

  async function getAll() {
    await initialize();
    const result = await request('list');
    if (!Array.isArray(result.tasks)) {
      throw new Error('ข้อมูลรายการงานจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    permissions = result.permissions || {};
    return result.tasks;
  }

  async function getTrash() {
    await initialize();
    const result = await request('trash');
    if (!Array.isArray(result.tasks)) {
      throw new Error('ข้อมูลถังขยะจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    return result.tasks;
  }

  async function getTechnicians() {
    await initialize();
    const result = await request('technicians');
    if (!Array.isArray(result.technicians)) {
      throw new Error('ข้อมูลรายชื่อช่างจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    return result.technicians;
  }

  async function getAssistants() {
    await initialize();
    const result = await request('assistants');
    if (!Array.isArray(result.assistants)) {
      throw new Error('ข้อมูลรายชื่อช่างช่วยเหลือจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    return result.assistants;
  }

  async function getRequesters() {
    await initialize();
    const result = await request('requesters');
    if (!Array.isArray(result.requesters)) {
      throw new Error('ข้อมูลรายชื่อผู้แจ้งจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    return result.requesters;
  }

  async function getPermissions() {
    await initialize();
    const result = await request('permissions');
    if (!result.permissions || typeof result.permissions !== 'object') {
      throw new Error('ข้อมูลสิทธิ์การใช้งานจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    permissions = result.permissions;
    return permissions;
  }

  async function create(task) {
    await initialize();
    const result = await request('create', task);
    return result.id;
  }

  async function update(task) {
    await initialize();
    await request('update', task);
  }

  async function bulkUpdate(tasks) {
    await initialize();
    await request('bulkUpdate', { tasks });
  }

  async function bulkDelete(ids) {
    await initialize();
    await request('bulkDelete', { ids });
  }

  async function restore(id) {
    await initialize();
    await request('restore', { id });
  }

  async function assignTechnician(id, technicianId) {
    await initialize();
    await request('assignTechnician', { id, technicianId });
  }

  async function assignAssistant(id, technicianId) {
    await initialize();
    await request('assignAssistant', { id, technicianId });
  }

  async function remove(id) {
    await initialize();
    await request('delete', { id });
  }

  async function updateStatus(id, status) {
    await initialize();
    await request('updateStatus', { id, status });
  }

  async function getNotifications() {
    await initialize();
    const result = await request('notifications');
    if (!Array.isArray(result.notifications) || !Number.isInteger(result.unreadCount)) {
      throw new Error('ข้อมูลการแจ้งเตือนจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    return result;
  }

  async function markNotificationsRead(notificationId) {
    await initialize();
    await request('markNotificationsRead', notificationId ? { notificationId } : {});
  }

  return {
    getAll,
    getTrash,
    getTechnicians,
    getAssistants,
    getRequesters,
    getPermissions,
    hasPermission: permission => permissions[permission] === true,
    getNotifications,
    markNotificationsRead,
    create,
    update,
    bulkUpdate,
    bulkDelete,
    restore,
    assignTechnician,
    assignAssistant,
    remove,
    updateStatus
  };
})();
