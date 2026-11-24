import { getSupabaseClient } from '../src/supabase.js';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('forgotPasswordForm');
  const emailInput = document.getElementById('recoveryEmail');
  const submitButton = form.querySelector('[type="submit"]');
  const errorMessage = document.getElementById('forgotPasswordError');
  const successMessage = document.getElementById('forgotPasswordSuccess');
  let submitting = false;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;

    errorMessage.textContent = '';
    errorMessage.classList.remove('show');
    successMessage.hidden = true;
    if (!form.reportValidity()) return;

    submitting = true;
    submitButton.disabled = true;
    try {
      const redirectTo = new URL('ResetPassword.html', window.location.href).toString();
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(
        emailInput.value.trim(),
        { redirectTo }
      );
      if (error) throw error;

      form.reset();
      successMessage.hidden = false;
    } catch (error) {
      errorMessage.textContent = `ส่งคำขอตั้งรหัสผ่านใหม่ไม่สำเร็จ: ${error.message || 'กรุณาลองอีกครั้ง'}`;
      errorMessage.classList.add('show');
    } finally {
      submitting = false;
      submitButton.disabled = false;
    }
  });
});
