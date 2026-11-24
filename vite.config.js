import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: '/Computer-Install/',
  build: {
    rolldownOptions: {
      input: {
        index: resolve(root, 'index.html'),
        login: resolve(root, 'Login.html'),
        forgotPassword: resolve(root, 'ForgotPassword.html'),
        register: resolve(root, 'Register.html'),
        profile: resolve(root, 'Profile.html'),
        report: resolve(root, 'Report.html'),
        resetPassword: resolve(root, 'ResetPassword.html'),
        services: resolve(root, 'services.html'),
        staff: resolve(root, 'Staff.html'),
        work: resolve(root, 'Work.html')
      }
    }
  }
});
