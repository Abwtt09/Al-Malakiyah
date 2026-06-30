/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./assets/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        'charcoal': '#0D0D0D',
        'gold': '#C6A24F',
        'gold-light': '#D4B773',
        'text-light': '#F5F5F5',
        'text-muted': '#888888',
        'border-dim': 'rgba(255, 255, 255, 0.1)'
      },
      fontFamily: {
        'ar': ['"IBM Plex Sans Arabic"', 'sans-serif'],
        'en': ['Inter', 'sans-serif']
      },
      letterSpacing: {
        'widest': '.25em',
      },
      spacing: {
        'section': '15vh',
      }
    },
  },
  plugins: [],
}
