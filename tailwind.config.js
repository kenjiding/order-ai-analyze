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
        // 这里不要再加 teal —— 与 Tailwind 默认调色板同名的键会整个覆盖掉它的色阶，
        // 曾经的 teal: '#52b9b1' 让全站 teal-50 ~ teal-900 全部失效（图标、色条、标签变白）。
        // 自定义色请用不会撞名的键名。
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
