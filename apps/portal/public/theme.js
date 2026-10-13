// Apply the saved (or system) theme before first paint. Kept as a file so the CSP can forbid inline scripts.
try {
  var t = localStorage.getItem('foxtail_theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
