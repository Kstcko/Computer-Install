import { getSupabaseClient } from '../src/supabase.js';
import { MVP_READ_ONLY, MVP_READ_ONLY_MESSAGE } from '../src/mvp-mode.js';
import { AppAuth } from './core/auth.js';
import { TaskStore } from './tasks/task-store.js';

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('installReportForm');
  const taskSelect = document.getElementById('reportTask');
  const taskDetails = document.getElementById('reportTaskDetails');
  const technicianInput = document.getElementById('assignedTechnician');
  const photoInput = document.getElementById('reportPhotos');
  const photoPreview = document.getElementById('reportPhotoPreview');
  const message = document.getElementById('reportFormMessage');
  const submitButton = document.getElementById('submitReport');
  const successPanel = document.getElementById('reportSuccess');
  const successMessage = document.getElementById('reportSuccessMessage');
  const previewUrls = [];

  try {
    if (!await AppAuth.requireProtectedPage()) return;
  } catch (error) {
    message.textContent = error.message || 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ';
    return;
  }

  if (MVP_READ_ONLY) {
    form.hidden = true;
    const notice = document.getElementById('reportReadOnlyNotice');
    if (notice) {
      notice.hidden = false;
      notice.textContent = `${MVP_READ_ONLY_MESSAGE}: การส่ง Report และอัปโหลดรูปภาพยังไม่เปิดใช้งาน`;
    }
    return;
  }

  const updateTaskDetails = tasks => {
    const task = tasks.find(item => String(item.id) === taskSelect.value);
    technicianInput.value = task?.technician || '';
    taskDetails.textContent = task
      ? `${task.department || 'ไม่ระบุผู้แจ้ง'} • ${task.assetIdentifier || 'ไม่มี Serial Number'} • ${task.detail}`
      : '';
  };

  const clearPreviews = () => {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    previewUrls.length = 0;
    photoPreview.replaceChildren();
  };

  const renderPreviews = files => {
    clearPreviews();
    files.forEach(file => {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      const caption = document.createElement('figcaption');
      image.src = url;
      image.alt = 'ตัวอย่างรูปภาพที่จะส่ง';
      caption.textContent = file.name;
      figure.append(image, caption);
      photoPreview.append(figure);
    });
  };

  const canvasToBlob = (canvas, quality) => new Promise(resolve => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

  const compressPhoto = async file => {
    const imageUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();

      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('เตรียมรูปภาพไม่สำเร็จ');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      let blob = await canvasToBlob(canvas, .78);
      if (!blob) throw new Error('ประมวลผลรูปภาพไม่สำเร็จ');
      if (blob.size > 800000) {
        const reducedCanvas = document.createElement('canvas');
        const reducedScale = Math.min(1, 1100 / Math.max(canvas.width, canvas.height));
        reducedCanvas.width = Math.max(1, Math.round(canvas.width * reducedScale));
        reducedCanvas.height = Math.max(1, Math.round(canvas.height * reducedScale));
        const reducedContext = reducedCanvas.getContext('2d');
        if (!reducedContext) throw new Error('ปรับขนาดรูปภาพไม่สำเร็จ');
        reducedContext.drawImage(canvas, 0, 0, reducedCanvas.width, reducedCanvas.height);
        blob = await canvasToBlob(reducedCanvas, .62);
      }
      if (!blob || blob.size > 800000) {
        throw new Error('รูปภาพมีขนาดใหญ่เกินไปหลังปรับขนาด');
      }
      return blob;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  };

  photoInput.addEventListener('change', () => {
    message.textContent = '';
    const files = [...photoInput.files];
    if (files.length > 5) {
      photoInput.value = '';
      clearPreviews();
      message.textContent = 'แนบรูปภาพได้ไม่เกิน 5 รูป';
      return;
    }
    if (files.some(file => !file.type.startsWith('image/'))) {
      photoInput.value = '';
      clearPreviews();
      message.textContent = 'กรุณาเลือกไฟล์รูปภาพเท่านั้น';
      return;
    }
    renderPreviews(files);
  });

  taskSelect.addEventListener('change', () => updateTaskDetails(eligibleTasks));
  let eligibleTasks = [];

  form.addEventListener('submit', async event => {
    event.preventDefault();
    message.textContent = '';
    if (!form.reportValidity()) return;

    const files = [...photoInput.files];
    if (files.length < 1 || files.length > 5) {
      message.textContent = 'กรุณาแนบรูปภาพ 1 ถึง 5 รูป';
      return;
    }

    submitButton.disabled = true;
    message.textContent = 'กำลังปรับขนาดและบันทึกรูปภาพ...';
    let uploadedCount = 0;
    try {
      const photos = await Promise.all(files.map(compressPhoto));
      const storage = getSupabaseClient().storage.from('install-report-photos');
      const uploadedPaths = [];
      for (const photo of photos) {
        const path = `${taskSelect.value}/${crypto.randomUUID()}.jpg`;
        const { error } = await storage.upload(path, photo, {
          contentType: 'image/jpeg',
          upsert: false
        });
        if (error) throw error;
        uploadedPaths.push(path);
        uploadedCount += 1;
      }

      const { error } = await getSupabaseClient().rpc('submit_install_report', {
        p_item_id: taskSelect.value,
        p_computer_type: document.getElementById('computerType').value.trim(),
        p_brand: document.getElementById('computerBrand').value.trim(),
        p_specifications_checked: document.getElementById('specificationsChecked').checked,
        p_neatness_checked: document.getElementById('neatnessChecked').checked,
        p_warranty_seal_applied: document.getElementById('warrantySealApplied').checked,
        p_photo_paths: uploadedPaths
      });
      if (error) {
        throw error;
      }

      const submittedTask = eligibleTasks.find(task => task.id === taskSelect.value);
      form.hidden = true;
      successMessage.textContent = `งาน ${submittedTask?.taskId || ''} ถูกบันทึกพร้อมรูปภาพแล้ว`;
      successPanel.hidden = false;
    } catch (error) {
      const cleanupWarning = uploadedCount
        ? ' รูปที่อัปโหลดแล้วอาจยังอยู่ใน Private Storage และต้องให้ผู้ดูแลตรวจสอบ'
        : '';
      message.textContent = `${error.message || 'บันทึก Report ไม่สำเร็จ กรุณาลองใหม่'}${cleanupWarning}`;
      submitButton.disabled = false;
    }
  });

  window.addEventListener('pagehide', clearPreviews, { once: true });

  form.hidden = false;
  submitButton.disabled = true;
  try {
    const [tasks, { data: reports, error: reportsError }] = await Promise.all([
      TaskStore.getAll(),
      getSupabaseClient().from('install_reports').select('install_item_id')
    ]);
    if (reportsError) throw reportsError;
    const reportedTaskIds = new Set((reports || []).map(report => report.install_item_id));
    eligibleTasks = tasks.filter(task =>
      task.status === 'done'
      && task.technician
      && !reportedTaskIds.has(task.id)
    );
    taskSelect.replaceChildren(new Option('เลือกงานที่ติดตั้งเสร็จแล้ว', ''));
    eligibleTasks.forEach(task => {
      const option = new Option(
        `${task.taskId} • ${task.assetIdentifier || 'ไม่มี Serial Number'} • ${task.department || 'ไม่ระบุผู้แจ้ง'}`,
        task.id
      );
      taskSelect.add(option);
    });

    const requestedTaskId = new URLSearchParams(window.location.search).get('taskId') || '';
    if (requestedTaskId && eligibleTasks.some(task => String(task.id) === requestedTaskId)) {
      taskSelect.value = requestedTaskId;
    } else if (requestedTaskId) {
      taskDetails.textContent = 'งานนี้อาจยังไม่เสร็จ ไม่มีช่างรับงาน หรือมี Report แล้ว กรุณาเลือกงานอื่น';
      message.textContent = 'ไม่สามารถส่ง Report สำหรับงานที่เลือกได้';
    }
    taskSelect.disabled = eligibleTasks.length === 0;
    submitButton.disabled = eligibleTasks.length === 0;
    if (eligibleTasks.length === 0) {
      message.textContent = 'ไม่มีงานที่เสร็จแล้วและยังไม่มี Report';
    }
    updateTaskDetails(eligibleTasks);
  } catch (error) {
    taskSelect.replaceChildren(new Option('โหลดรายการงานไม่สำเร็จ', ''));
    taskSelect.disabled = true;
    message.textContent = error.message || 'โหลดรายการงานสำหรับ Report ไม่สำเร็จ';
  }
});
