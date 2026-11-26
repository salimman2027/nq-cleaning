import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AuthProvider } from './auth';
import { I18nProvider } from './i18n';
import './index.css';

registerSW({ immediate: true });

try {
  if (localStorage.getItem('nq.dark') === '1') document.documentElement.classList.add('dark');
} catch { /* ignore */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
