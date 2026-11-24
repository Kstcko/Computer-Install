import { getSupabaseClient } from '../src/supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('resetPasswordForm');
  const message = document.getElementById('resetPasswordMessage');
  const requestNewResetLink = document.getElementById('requestNewResetLink');
  const submitButton = form.querySelector('[type="submit"]');
  const currentUrl = new URL(window.location.href);
  const callbackFragment = new URLSearchParams(currentUrl.hash.slice(1));
  const hasAuthCallback = currentUrl.searchParams.has('code')
    || callbackFragment.has('access_token')
    || callbackFragment.has('error');
  const hasRecoveryMarker = currentUrl.searchParams.get('recovery') === '1';
  let client;
  let recoverySession = null;
  let recoverySubscription;

  try {
    client = getSupabaseClient();
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        recoverySession = session;
      }
    });
    recoverySubscription = listener.subscription;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (hasAuthCallback && !recoverySession) {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    }

    const hasRecoveryEvent = recoverySession?.user.id === data.session?.user.id;
    if (!data.session || (!hasRecoveryEvent && !hasRecoveryMarker)) {
      throw new Error('ลิงก์ตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่');
    }

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!userData.user || userData.user.id !== data.session.user.id) {
      throw new Error('ยืนยัน Session สำหรับตั้งรหัสผ่านไม่สำเร็จ กรุณาขอลิงก์ใหม่');
    }

    if (hasRecoveryEvent && !hasRecoveryMarker) {
      const recoveryUrl = new URL(window.location.href);
      recoveryUrl.searchParams.set('recovery', '1');
      recoveryUrl.hash = '';
      window.history.replaceState(
        window.history.state,
        '',
        `${recoveryUrl.pathname}${recoveryUrl.search}`
      );
    }
    form.hidden = false;
  } catch (error) {
    recoverySubscription?.unsubscribe();
    message.textContent = `ตรวจสอบลิงก์ตั้งรหัสผ่านไม่สำเร็จ: ${error.message || 'กรุณาลองขอลิงก์ใหม่'}`;
    message.classList.add('show');
    requestNewResetLink.hidden = false;
    return;
  }

  let submitting = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    message.textContent = '';
    message.classList.remove('show');

    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('confirmPassword').value;
    if (password.length < 8 || password.length > 72) {
      message.textContent = 'รหัสผ่านต้องมีความยาว 8 ถึง 72 ตัวอักษร';
      message.classList.add('show');
      return;
    }
    if (password !== confirmation) {
      message.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
      message.classList.add('show');
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      recoverySubscription.unsubscribe();
      window.location.replace('Login.html?passwordReset=success');
    } catch (error) {
      message.textContent = `ตั้งรหัสผ่านใหม่ไม่สำเร็จ: ${error.message || 'กรุณาลองอีกครั้ง'}`;
      message.classList.add('show');
      submitting = false;
      submitButton.disabled = false;
    }
  });
});
