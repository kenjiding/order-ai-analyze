import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base：仅默认 production 构建挂载在 /dist；开发、preview、以及 vite build --mode test|staging 等仍用 /
export default defineConfig(() => ({
  base: '/',
  plugins: [react()],
  server: {
    host: true,
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 大体积来自 maplibre-gl / exceljs / xlsx / @antv/g2 等第三方库自身,均已按需异步加载,不在首屏路径
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        fleetSupplierPush: resolve(__dirname, 'fleet-supplier-push.html'),
        deliveringNotify: resolve(__dirname, 'delivering-notify.html'),
        returnToMerchant: resolve(__dirname, 'return-to-merchant.html'),
        scanStat: resolve(__dirname, 'scan-stat.html'),
      },
    },
  },
}))
