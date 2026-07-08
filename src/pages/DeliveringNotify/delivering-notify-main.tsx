import { createRoot } from 'react-dom/client'
import '../../index.css'
import { AppSettingsProvider } from '../../context/AppSettingsContext'
import { DeliveringNotifyAuthGate } from './DeliveringNotifyAuthGate'

createRoot(document.getElementById('root')!).render(
  <AppSettingsProvider>
    <DeliveringNotifyAuthGate />
  </AppSettingsProvider>,
)
