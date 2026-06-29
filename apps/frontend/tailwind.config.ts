import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        brand: {
          50: '#EEF3FF',
          100: '#D9E4FF',
          500: '#1A56DB',
          600: '#1445B8',
          700: '#0D329A',
        },
        navy: {
          900: '#0D1B2A',
          800: '#1A3A5C',
          700: '#2D4057',
        },
        danger: '#C0392B',
      },
    },
  },
  plugins: [],
} satisfies Config
