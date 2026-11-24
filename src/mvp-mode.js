export const MVP_READ_ONLY = true;

export const MVP_READ_ONLY_MESSAGE =
  'ฟังก์ชันนี้ปิดไว้ชั่วคราวใน Read-only MVP';

export const WORK_MANAGEMENT_ENABLED = true;

export function assertWorkManagementEnabled() {
  if (!WORK_MANAGEMENT_ENABLED) {
    throw new Error('ระบบจัดการงานยังไม่เปิดใช้งาน');
  }
}

export function assertBusinessMutationDisabled() {
  if (MVP_READ_ONLY) {
    throw new Error(MVP_READ_ONLY_MESSAGE);
  }
}
