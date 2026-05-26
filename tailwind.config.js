/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#08111f',
        steel: '#243449',
        cloud: '#e8edf3',
        brass: '#c6a46a',
        teal: '#52b9b1',
        cobalt: '#0f4c81',
      },
      boxShadow: {
        glow: '0 30px 80px rgba(5, 12, 24, 0.28)',
        panel: '0 20px 60px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
}
