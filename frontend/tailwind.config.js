/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#16213E',        // deep navy-slate — headings, primary text
        paper: '#F7F8FA',      // page background
        surface: '#FFFFFF',    // card background
        brand: '#2E5C8A',      // primary academic blue — actions, links
        safe: '#2F8F5B',       // risk: safe
        watch: '#C98A1F',      // risk: watch
        atrisk: '#C1443A',     // risk: at-risk
        slate: { 600: '#54607A' },
      },
      fontFamily: {
        display: ['"Lora"', 'serif'],
        body: ['"Inter"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(22,33,62,0.06), 0 6px 20px -10px rgba(22,33,62,0.15)',
      },
    },
  },
  plugins: [],
};
