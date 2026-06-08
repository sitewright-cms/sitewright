import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Sitewright brand type, self-hosted via @fontsource (no runtime font CDN):
// Space Grotesk (display/wordmark) + Inter (UI/body).
import '@fontsource-variable/space-grotesk';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles.css';
import { App } from './App';
import { ToastProvider } from './views/ui/Toast';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
