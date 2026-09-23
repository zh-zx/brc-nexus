/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0A0A0A',
        paper: '#F5F5F2',
        acid: '#FFE24A',
        moss: '#2E7D32',
        ash: {
          0: '#FFFFFF',
          100: '#F5F5F2',
          200: '#E5E5E0',
          300: '#C7C7BF',
          400: '#9C9C92',
          500: '#6F6F66',
          600: '#4A4A43',
          700: '#2E2E29',
          800: '#1A1A17',
          900: '#0A0A0A',
        },
      },
      boxShadow: {
        'hard-sm': '3px 3px 0 #0A0A0A',
        'hard': '4px 4px 0 #0A0A0A',
        'hard-lg': '6px 6px 0 #0A0A0A',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Cascadia Mono', 'Consolas', 'SF Mono', 'Menlo', 'monospace'],
        display: ['Georgia', 'Iowan Old Style', 'Times New Roman', 'Noto Serif SC', 'Songti SC', 'serif'],
      },
    },
  },
  plugins: [],
}
