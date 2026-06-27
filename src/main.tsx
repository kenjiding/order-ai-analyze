import { createRoot } from 'react-dom/client'
import './index.css'
import './scrollbar.css'
import App from './App.tsx'

// react-activation 与 StrictMode 不兼容；见 node_modules/react-activation/README_CN.md
createRoot(document.getElementById('root')!).render(<App />)
