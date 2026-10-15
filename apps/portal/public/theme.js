// Apply the saved theme before first paint. Foxtail brand defaults to dark mode.
// Kept as a file so the CSP can forbid inline scripts.
try {
  var t = localStorage.getItem('foxtail_theme');
  // Default to dark (Foxtail brand) unless user explicitly chose light
  if (t !== 'light') document.documentElement.classList.add('dark');
} catch (e) {}
