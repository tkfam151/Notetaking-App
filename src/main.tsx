import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/700.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/roboto-mono/400.css';
import './styles/app.css';
import './styles/editor.css';
import App from './App';
import { UIProvider } from './components/ui';
import { isElectron, isNative } from './lib/platform';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UIProvider>
      <App />
    </UIProvider>
  </StrictMode>,
);

// Offline support: register the service worker only when served over http(s)
// (not inside Electron's file:// or the native mobile shells, which are already offline).
if (location.protocol.startsWith('http') && !isElectron && !isNative && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
