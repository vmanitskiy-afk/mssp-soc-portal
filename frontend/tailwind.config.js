/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          200: '#bce0ff',
          300: '#8ecdff',
          400: '#59b0ff',
          500: '#338bff',
          600: '#1a6af5',
          700: '#1354e1',
          800: '#1644b6',
          900: '#183d8f',
          950: '#132757',
        },
        surface: {
          DEFAULT: '#0f1117',
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5d9e2',
          300: '#b0b8c9',
          400: '#8593ab',
          500: '#657591',
          600: '#505e78',
          700: '#424d62',
          800: '#394253',
          900: '#1a1d27',
          950: '#0f1117',
        },
        severity: {
          critical: '#ef4444',
          high: '#f97316',
          medium: '#eab308',
          low: '#3b82f6',
        },
        status: {
          new: '#818cf8',
          in_progress: '#38bdf8',
          awaiting: '#fbbf24',
          resolved: '#34d399',
          closed: '#6b7280',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
