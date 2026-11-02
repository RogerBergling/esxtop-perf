/* Apply the saved theme before first paint. Kept as an external file because
   the server CSP deliberately forbids inline scripts. */
(() => {
  try {
    const saved = localStorage.getItem('esxtop-lens-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.dataset.theme = saved;
    } else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      document.documentElement.dataset.theme = 'light';
    }
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
})();
