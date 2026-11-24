import { getSupabaseClient } from '../src/supabase.js';
import { MVP_READ_ONLY } from '../src/mvp-mode.js';
import { AppAuth } from './core/auth.js';
import { AppDialogs } from './core/dialogs.js';

document.addEventListener('DOMContentLoaded', async () => {
  const roleLabels = {
    admin: 'Admin',
    developer: 'Developer',
    technician: 'ช่าง',
    intern: 'นักศึกษาฝึกงาน'
  };
  const profileInfo = document.getElementById('profileInfo');
  const profileMessage = document.getElementById('profileMessage');
  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');
  const profileForm = document.getElementById('profileForm');
  const editProfileButton = document.getElementById('editProfileButton');
  const profilePhotoControl = document.getElementById('profilePhotoControl');
  const imageInput = document.getElementById('profileImageInput');
  const staffManagementLink = document.getElementById('staffManagementLink');
  let currentUser = null;

  const showSignedOut = message => {
    profileMessage.textContent = message;
    profileMessage.classList.add('p-login');
    profileInfo.hidden = true;
    profilePhotoControl.hidden = true;
    imageInput.hidden = true;
    loginButton.hidden = false;
    logoutButton.hidden = true;
    staffManagementLink.hidden = true;
  };

  const updateAvatarStyle = style => {
    profilePhotoControl.classList.remove('p-round', 'p-frame');
    if (style === 'rounded') profilePhotoControl.classList.add('p-round');
    if (style === 'frame') profilePhotoControl.classList.add('p-frame');
  };

  const displayUser = user => {
    currentUser = user;
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'ผู้ใช้งาน';
    document.getElementById('profileName').textContent = fullName;
    document.getElementById('profileEmail').textContent = user.email || '-';
    document.getElementById('profilePhone').textContent = user.phone || '-';
    document.getElementById('profileRole').textContent = roleLabels[user.role] || 'ยังไม่ได้กำหนด';
    document.getElementById('profileImage').src = user.avatar || 'https://i.pravatar.cc/128?img=12';
    document.getElementById('profileImage').alt = `รูปโปรไฟล์ของ ${fullName}`;
    updateAvatarStyle(user.avatarStyle || 'circle');

    profileMessage.textContent = '';
    profileMessage.classList.remove('p-login');
    profileInfo.hidden = false;
    profilePhotoControl.hidden = false;
    loginButton.hidden = true;
    logoutButton.hidden = false;
    editProfileButton.hidden = false;
    staffManagementLink.hidden = !['admin', 'developer'].includes(user.role);
  };

  const setProfileFormValues = () => {
    document.getElementById('firstNameInput').value = currentUser.firstName || '';
    document.getElementById('lastNameInput').value = currentUser.lastName || '';
  };

  try {
    await AppAuth.initialize();
    currentUser = AppAuth.getCurrentUser();
  } catch (error) {
    showSignedOut(error.message || 'โหลดข้อมูลบัญชีไม่สำเร็จ');
    return;
  }

  if (!currentUser) {
    showSignedOut('กรุณาเข้าสู่ระบบเพื่อดูโปรไฟล์');
    return;
  }

  displayUser(currentUser);
  profilePhotoControl.removeAttribute('for');
  profilePhotoControl.querySelector('.p-photo-btn')?.setAttribute('hidden', '');
  imageInput.hidden = true;

  if (!MVP_READ_ONLY) {
    editProfileButton.addEventListener('click', () => {
      setProfileFormValues();
      profileForm.hidden = false;
      editProfileButton.hidden = true;
      document.getElementById('firstNameInput').focus();
    });

    document.getElementById('cancelProfileButton').addEventListener('click', () => {
      profileForm.hidden = true;
      editProfileButton.hidden = false;
    });

    profileForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!profileForm.reportValidity()) return;
      if (!await AppDialogs.confirm('ยืนยันบันทึกการเปลี่ยนแปลงชื่อและนามสกุลหรือไม่?', {
        title: 'บันทึกข้อมูลโปรไฟล์',
        confirmText: 'บันทึก'
      })) return;

      const submitButton = document.getElementById('saveProfileButton');
      submitButton.disabled = true;
      profileMessage.textContent = 'กำลังบันทึกชื่อ...';
      try {
        const { error } = await getSupabaseClient()
          .from('profiles')
          .update({
            first_name: document.getElementById('firstNameInput').value.trim(),
            last_name: document.getElementById('lastNameInput').value.trim()
          })
          .eq('id', currentUser.userId);
        if (error) throw error;

        const updatedUser = await AppAuth.refreshCurrentUser();
        if (!updatedUser) throw new Error('โหลดข้อมูล Profile หลังบันทึกไม่สำเร็จ');
        displayUser(updatedUser);
        profileForm.hidden = true;
        profileMessage.textContent = 'บันทึกข้อมูลโปรไฟล์แล้ว';
      } catch (error) {
        profileMessage.textContent = error.message || 'บันทึกข้อมูลโปรไฟล์ไม่สำเร็จ';
      } finally {
        submitButton.disabled = false;
      }
    });
  } else {
    editProfileButton.disabled = true;
  }

  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      await AppAuth.logout();
      window.location.replace('Login.html');
    } catch (error) {
      profileMessage.textContent = error.message || 'ออกจากระบบไม่สำเร็จ';
      logoutButton.disabled = false;
    }
  });
});
