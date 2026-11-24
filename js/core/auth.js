/* กติกาการเข้าสู่ระบบของแอป */
const currentUserKey = 'install_current_user';
const protectedPages = ['services.html', 'Work.html', 'Report.html'];

function getCurrentUser() {
  const user = AppStorage.readSession(currentUserKey) || AppStorage.read(currentUserKey);
  return user && typeof user === 'object' && user.email ? user : null;
}

function setCurrentUser(user, remember = AppStorage.read(`${currentUserKey}_remember`, false)) {
  AppStorage.removeSession(currentUserKey);
  if (remember) {
    AppStorage.write(currentUserKey, user);
    AppStorage.write(`${currentUserKey}_remember`, true);
    return;
  }

  AppStorage.remove(currentUserKey);
  AppStorage.remove(`${currentUserKey}_remember`);
  AppStorage.writeSession(currentUserKey, user);
}

function logout() {
  AppStorage.removeSession(currentUserKey);
  AppStorage.remove(currentUserKey);
  AppStorage.remove(`${currentUserKey}_remember`);
}

function requireProtectedPage() {
  const page = window.location.pathname.split('/').pop() || 'services.html';
  if (!protectedPages.includes(page) || getCurrentUser()) return true;

  const returnTo = `${page}${window.location.search}${window.location.hash}`;
  window.location.replace(`Login.html?returnTo=${encodeURIComponent(returnTo)}`);
  return false;
}

function getLoginDestination() {
  const requestedPage = new URLSearchParams(window.location.search).get('returnTo');
  const page = requestedPage ? requestedPage.split(/[?#]/)[0] : '';
  return requestedPage && protectedPages.includes(page) ? requestedPage : 'Profile.html';
}

const AppAuth = {
  getCurrentUser,
  setCurrentUser,
  logout,
  requireProtectedPage,
  getLoginDestination
};
