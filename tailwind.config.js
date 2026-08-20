/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Tajawal', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        arabic: ['Tajawal', 'Arial', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out forwards',
        'slide-down': 'slideDown 0.3s ease-out forwards',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
      },
    },
  },
  plugins: [],
};
