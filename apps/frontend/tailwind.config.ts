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
      keyframes: {
        'popover-in': {
          '0%': { opacity: '0', transform: 'scale(0.95) translateY(-4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'popover-out': {
          '0%': { opacity: '1', transform: 'scale(1) translateY(0)' },
          '100%': { opacity: '0', transform: 'scale(0.95) translateY(-4px)' },
        },
        'modal-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'modal-out': {
          '0%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.95)' },
        },
        'backdrop-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'backdrop-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
      },
      animation: {
        'popover-in': 'popover-in 160ms ease-out forwards',
        'popover-out': 'popover-out 120ms ease-in forwards',
        'modal-in': 'modal-in 180ms ease-out forwards',
        'modal-out': 'modal-out 150ms ease-in forwards',
        'backdrop-in': 'backdrop-in 180ms ease-out forwards',
        'backdrop-out': 'backdrop-out 150ms ease-in forwards',
      },
    },
  },
  plugins: [],
} satisfies Config
