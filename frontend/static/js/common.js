function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/check');
    if (res.status === 401) {
      window.location.href = '/';
    }
  } catch {
    window.location.href = '/';
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

function setActiveNav(page) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.page === page) el.classList.add('active');
  });
}

const ADMIN_THEME_STORAGE_KEY = 'neuron-admin-theme';
const ADMIN_THEME_DARK = 'dark';
const ADMIN_THEME_LIGHT = 'light';

function isAdminAnalyticsPage() {
  return Boolean(document.body?.classList.contains('analytics-page') && document.querySelector('.admin-layout'));
}

function normalizeAdminTheme(theme) {
  return theme === ADMIN_THEME_LIGHT ? ADMIN_THEME_LIGHT : ADMIN_THEME_DARK;
}

function getStoredAdminTheme() {
  try {
    return normalizeAdminTheme(localStorage.getItem(ADMIN_THEME_STORAGE_KEY));
  } catch {
    return ADMIN_THEME_DARK;
  }
}

function saveAdminTheme(theme) {
  try {
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, normalizeAdminTheme(theme));
  } catch {
    // Ignore write errors and keep the active theme in-memory.
  }
}

function updateThemeToggleButton(theme) {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const isLight = theme === ADMIN_THEME_LIGHT;
  const icon = toggle.querySelector('.theme-toggle-icon');
  const label = toggle.querySelector('.theme-toggle-label');
  toggle.setAttribute('aria-pressed', String(isLight));
  toggle.setAttribute('title', isLight ? 'تغییر به حالت تیره' : 'تغییر به حالت روشن');
  if (icon) icon.textContent = isLight ? '☀️' : '🌙';
  if (label) label.textContent = isLight ? 'حالت روشن' : 'حالت تیره';
}

function applyAdminTheme(theme) {
  const nextTheme = normalizeAdminTheme(theme);
  document.documentElement.setAttribute('data-theme', nextTheme);
  document.documentElement.style.colorScheme = nextTheme;
  updateThemeToggleButton(nextTheme);
  window.dispatchEvent(new CustomEvent('admin-theme-change', { detail: { theme: nextTheme } }));
  return nextTheme;
}

function createThemeToggle(theme) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'theme-toggle';
  button.className = 'theme-toggle-btn';
  button.setAttribute('aria-live', 'polite');
  button.setAttribute('aria-label', 'تغییر تم پنل مدیریت');
  button.innerHTML = '<span class="theme-toggle-icon" aria-hidden="true"></span><span class="theme-toggle-label"></span>';

  button.addEventListener('click', () => {
    const currentTheme = normalizeAdminTheme(document.documentElement.getAttribute('data-theme'));
    const nextTheme = currentTheme === ADMIN_THEME_DARK ? ADMIN_THEME_LIGHT : ADMIN_THEME_DARK;
    applyAdminTheme(nextTheme);
    saveAdminTheme(nextTheme);
  });

  return button;
}

function initAdminTheme() {
  if (!isAdminAnalyticsPage()) return;

  const themeFromDom = document.documentElement.getAttribute('data-theme');
  const initialTheme = normalizeAdminTheme(themeFromDom || getStoredAdminTheme());
  applyAdminTheme(initialTheme);

  const sidebarFooter = document.querySelector('.sidebar-footer');
  if (!sidebarFooter || document.getElementById('theme-toggle')) return;
  sidebarFooter.insertBefore(createThemeToggle(initialTheme), sidebarFooter.firstChild);
  updateThemeToggleButton(initialTheme);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminTheme);
} else {
  initAdminTheme();
}
