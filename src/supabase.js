import { createClient } from '@supabase/supabase-js';

const viteEnv = import.meta.env || {};
const supabaseUrl = typeof viteEnv.VITE_SUPABASE_URL === 'string'
  ? viteEnv.VITE_SUPABASE_URL.trim()
  : '';
const publishableKey = typeof viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY === 'string'
  ? viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
  : '';

let client;

function validateConfiguration() {
  if (!supabaseUrl || !publishableKey) {
    return 'ยังไม่ได้ตั้งค่า Supabase กรุณากำหนด VITE_SUPABASE_URL และ VITE_SUPABASE_PUBLISHABLE_KEY';
  }

  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return 'VITE_SUPABASE_URL ต้องเป็น URL ที่ถูกต้อง';
  }

  const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !isLocalHost)) {
    return 'VITE_SUPABASE_URL ต้องใช้ HTTPS ยกเว้นการพัฒนาในเครื่อง';
  }
  if (url.username || url.password || url.search || url.hash) {
    return 'VITE_SUPABASE_URL มีส่วนประกอบที่ไม่อนุญาต';
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    return 'VITE_SUPABASE_PUBLISHABLE_KEY ต้องเป็น Supabase Publishable Key ไม่ใช่ Secret หรือ Service Role Key';
  }

  return '';
}

const configurationError = validateConfiguration();

function getAuthFlowType() {
  if (typeof window === 'undefined') return 'implicit';

  const query = new URLSearchParams(window.location.search);
  if (query.has('code')) return 'pkce';

  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (fragment.has('access_token') || fragment.has('error')) return 'implicit';

  return 'implicit';
}

export function isSupabaseConfigured() {
  return configurationError === '';
}

export function getSupabaseClient() {
  if (configurationError) throw new Error(configurationError);

  if (!client) {
    client = createClient(supabaseUrl, publishableKey, {
      auth: {
        flowType: getAuthFlowType(),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  return client;
}
