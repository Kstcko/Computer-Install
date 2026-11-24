import { getSupabaseClient } from '../src/supabase.js';
import { AppAuth } from './core/auth.js';

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const resetSuccess = document.getElementById('passwordResetSuccess');
  if (new URLSearchParams(window.location.search).get('passwordReset') === 'success') {
    resetSuccess.hidden = false;
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    loginError.textContent = '';
    loginError.classList.remove('show');
    loginForm.classList.add('was-validated');

    if (!loginForm.checkValidity()) return;

    const formData = new FormData(loginForm);
    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
      const client = getSupabaseClient();
      const { error } = await client.auth.signInWithPassword({
        email: String(formData.get('email') || '').trim(),
        password: String(formData.get('password') || '')
      });
      if (error) throw error;
      const user = await AppAuth.refreshCurrentUser();
      if (!user) throw new Error('ยืนยันข้อมูล Profile ของบัญชีไม่สำเร็จ');
      window.location.href = AppAuth.getLoginDestination();
    } catch (error) {
      loginError.textContent = error.message || 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูลและการตั้งค่า';
      loginError.classList.add('show');
    } finally {
      submitButton.disabled = false;
    }
  });
});
