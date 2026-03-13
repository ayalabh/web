export function initTheme() {
  const saved = localStorage.getItem('shape-modeler-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  }
  updateThemeIcon();
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('shape-modeler-theme', next);
  updateThemeIcon();
  return next;
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function updateThemeIcon() {
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.src = getTheme() === 'dark' ? 'icons/sun.svg' : 'icons/moon.svg';
    icon.alt = getTheme() === 'dark' ? 'Switch to light' : 'Switch to dark';
  }
}
