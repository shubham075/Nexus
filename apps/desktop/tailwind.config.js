/** @type {import('tailwindcss').Config} */
// Neutral scale, surfaces and brand are CSS variables (see src/renderer/src/index.css),
// so every existing `zinc-*` / `bg-white` / `brand-*` class follows the light/dark theme.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (prefix, steps) => Object.fromEntries(steps.map((s) => [s, v(`${prefix}-${s}`)]));

module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        zinc: scale('n', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        brand: scale('b', [50, 100, 500, 600, 700]),
        canvas: v('canvas'),
        surface: v('surface'),
      },
      fontFamily: { sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', '-apple-system', 'Inter', 'sans-serif'] },
      boxShadow: { soft: '0 1px 2px rgb(0 0 0 / 0.04), 0 4px 16px -4px rgb(0 0 0 / 0.06)' },
    },
  },
  plugins: [],
};
