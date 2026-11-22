/* Apply the saved or server-configured theme before first paint.
   /theme.js supplies window.__APP_THEME__ from the APP_THEME environment
   variable. A visitor's explicit choice in the theme toggle wins. */
(() => {
  const root = document.documentElement;
  let saved = null;
  try {
    saved = localStorage.getItem('esxtop-lens-theme');
  } catch {
    /* Storage can be unavailable in hardened browser contexts. */
  }

  let theme = saved === 'light' || saved === 'dark' ? saved : null;
  if (!theme) {
    const configured = window.__APP_THEME__;
    if (configured === 'light' || configured === 'dark') {
      theme = configured;
    } else if (configured === 'system') {
      theme = window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
    } else {
      theme = 'dark';
    }
  }

  root.dataset.theme = theme;
  root.style.colorScheme = theme;
})();
