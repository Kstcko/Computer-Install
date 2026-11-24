import { getSupabaseClient, isSupabaseConfigured } from '../../src/supabase.js';

const protectedPages = new Set([
  'services.html',
  'Work.html',
  'Report.html',
  'Staff.html',
  'Profile.html'
]);
let currentUser = null;
let initialization = null;
let authListenerInstalled = false;

function installAuthListener(client) {
  if (authListenerInstalled) return;

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
    if (event === 'SIGNED_IN' && session?.user?.id === currentUser?.userId) return;
    currentUser = null;
    initialization = null;
  });
  authListenerInstalled = true;
}

async function loadProfile(authUser) {
  const client = getSupabaseClient();
  const { data: profile, error } = await client
    .from('profiles')
    .select('id, first_name, last_name, email, phone, role_code, department_id, avatar_url, avatar_style, is_active')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error) throw error;
  if (!profile) {
    throw new Error('ไม่พบ Profile ของบัญชีนี้ในฐานข้อมูล กรุณาติดต่อผู้ดูแลระบบ');
  }
  if (!profile.is_active) {
    await client.auth.signOut();
    throw new Error('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }

  currentUser = {
    userId: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: profile.email || authUser.email || '',
    phone: profile.phone || '',
    role: profile.role_code,
    departmentId: profile.department_id,
    avatar: profile.avatar_url,
    avatarStyle: profile.avatar_style,
    createdAt: authUser.created_at
  };
  return currentUser;
}

async function initialize() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า Supabase กรุณากำหนด URL และ Publishable Key ใน .env.local'
    );
  }

  const client = getSupabaseClient();
  installAuthListener(client);
  if (!initialization) {
    initialization = (async () => {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        currentUser = null;
        return null;
      }
      return loadProfile(data.session.user);
    })().catch(error => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

async function refreshCurrentUser() {
  const client = getSupabaseClient();
  installAuthListener(client);
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) {
    currentUser = null;
    initialization = Promise.resolve(null);
    return null;
  }

  initialization = Promise.resolve(loadProfile(data.user));
  return initialization;
}

async function logout() {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  currentUser = null;
  initialization = Promise.resolve(null);
}

async function requireProtectedPage() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  if (!protectedPages.has(page) && !isSupabaseConfigured()) return true;
  const user = await initialize();
  if (!protectedPages.has(page) || user) return true;

  const returnTo = `${page}${window.location.search}${window.location.hash}`;
  const loginUrl = new URL('Login.html', window.location.href);
  loginUrl.searchParams.set('returnTo', returnTo);
  window.location.replace(loginUrl);
  return false;
}

function getLoginDestination() {
  const requestedPage = new URLSearchParams(window.location.search).get('returnTo');
  const page = requestedPage ? requestedPage.split(/[?#]/)[0] : '';
  return requestedPage && protectedPages.has(page) ? requestedPage : 'Profile.html';
}

export const AppAuth = {
  initialize,
  refreshCurrentUser,
  getCurrentUser: () => currentUser,
  logout,
  requireProtectedPage,
  getLoginDestination
};
