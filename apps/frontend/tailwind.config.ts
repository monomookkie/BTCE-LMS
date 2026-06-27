import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // สีหลักของสภากาชาดไทย
        brand: {
          red: '#B91C1C',
          'red-light': '#DC2626',
          'red-dark': '#991B1B',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
