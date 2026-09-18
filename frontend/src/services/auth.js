// TEJAS Authentication compatibility shim.
// Auth is temporarily disabled; keep this API so existing UI code stays stable.

const TOKEN_KEY = 'tejas_auth_token';
const USER_KEY = 'tejas_auth_user';

const OPEN_USER = {
  username: 'open-operator',
  role: 'ADMIN',
  full_name: 'Duty Operator'
};

export const authService = {
  getToken() {
    return null;
  },

  getUser() {
    const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
    if (!raw) return OPEN_USER;
    try {
      return { ...OPEN_USER, ...JSON.parse(raw) };
    } catch {
      return OPEN_USER;
    }
  },

  isAuthenticated() {
    return true;
  },

  getRole() {
    const user = this.getUser();
    return (user?.role || OPEN_USER.role).toUpperCase();
  },

  hasRole(...allowedRoles) {
    if (!allowedRoles.length) return true;
    const userRole = this.getRole();
    const upperAllowed = allowedRoles.map(r => r.toUpperCase());
    return upperAllowed.includes(userRole);
  },

  async login(username) {
    const userProfile = {
      ...OPEN_USER,
      username: username || OPEN_USER.username,
      full_name: username || OPEN_USER.full_name
    };
    localStorage.setItem(USER_KEY, JSON.stringify(userProfile));
    window.dispatchEvent(new Event('tejas_auth_changed'));
    return userProfile;
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event('tejas_auth_changed'));
  }
};
