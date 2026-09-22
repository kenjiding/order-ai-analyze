import { createRoot } from 'react-dom/client'
import './index.css'
import './scrollbar.css'
import App from './App.tsx'

// 新版本发布后，旧 tab 里懒加载的 chunk hash 已在服务器上不存在，会触发 Vite 的 preloadError；
// 刷新一次即可拿到新版本 index.html，用 sessionStorage 防止刷新失败时死循环。
window.addEventListener('vite:preloadError', () => {
  const key = 'vite-preload-reloaded'
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  window.location.reload()
})

// react-activation 与 StrictMode 不兼容；见 node_modules/react-activation/README_CN.md
createRoot(document.getElementById('root')!).render(<App />)
