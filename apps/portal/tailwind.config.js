/** @type {import('tailwindcss').Config} */

/**
 * Semantic design tokens (carried over from Eye of Omni, in Foxtail Coffee colors: black, white, teal). Every value is a CSS
 * variable defined in src/index.css (light in :root, dark in html.dark), so `bg-surface text-ink
 * border-line` work in both themes without `dark:` variants.
 *
 *   Radius:  sm (4px) | control (8px) | panel (12px) | full
 *   Heights: control-sm (32px) | control-md (40px) | control-lg (44px)
 *   Type:    xl (24px) | lg (20px) | base (16px) | sm (14px) | xs (12px)
 *
 * Use these utilities in pages, not raw palette classes (slate-*, white, red-*).
 */
const token = (name) => `var(--${name})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        page: token('c-page'),
        surface: token('c-surface'),
        'surface-2': token('c-surface-2'),
        'surface-3': token('c-surface-3'),
        overlay: token('c-overlay'),
        line: token('c-line'),
        'line-2': token('c-line-2'),
        ink: token('c-ink'),
        'ink-2': token('c-ink-2'),
        'ink-3': token('c-ink-3'),
        'ink-4': token('c-ink-4'),
        brand: token('c-brand'),
        rust: token('c-rust'),
        accent: token('c-accent'),
        'accent-hover': token('c-accent-hover'),
        'accent-soft': token('c-accent-soft'),
        'accent-line': token('c-accent-line'),
        'accent-ink': token('c-accent-ink'),
        ok: token('c-ok'),
        'ok-fill': token('c-ok-fill'),
        'ok-soft': token('c-ok-soft'),
        'ok-line': token('c-ok-line'),
        warn: token('c-warn'),
        'warn-fill': token('c-warn-fill'),
        'warn-soft': token('c-warn-soft'),
        'warn-line': token('c-warn-line'),
        bad: token('c-bad'),
        'bad-fill': token('c-bad-fill'),
        'bad-fill-hover': token('c-bad-fill-hover'),
        'bad-soft': token('c-bad-soft'),
        'bad-line': token('c-bad-line'),
        info: token('c-info'),
        'info-fill': token('c-info-fill'),
        'info-soft': token('c-info-soft'),
        'info-line': token('c-info-line'),
      },
      fontFamily: {
        sans: ['Gotham', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        display: ['Gotham', 'Montserrat', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        elevated: 'var(--shadow-elevated)',
      },
      borderRadius: {
        sm: token('radius-sm'),
        control: token('radius-control'),
        panel: token('radius-panel'),
        full: token('radius-full'),
      },
      spacing: {
        'control-sm': token('control-height-sm'),
        'control-md': token('control-height-md'),
        'control-lg': token('control-height-lg'),
      },
      fontSize: {
        xl: [token('font-size-xl'), { lineHeight: '1.3' }],
        lg: [token('font-size-lg'), { lineHeight: '1.4' }],
        base: [token('font-size-base'), { lineHeight: '1.5' }],
        sm: [token('font-size-sm'), { lineHeight: '1.5' }],
        xs: [token('font-size-xs'), { lineHeight: '1.5' }],
      },
    },
  },
  plugins: [],
};
