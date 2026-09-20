import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/sora';
import './index.css';
import App from './App.jsx';
import { ToastProvider } from './hooks/useToast.jsx';
import { applyTheme } from './theme.js';
import { applyAppearance } from './appearance.js';
import './pwa.js';

applyTheme(localStorage.getItem('lgu-attendance-theme') === 'dark' ? 'dark' : 'light');
applyAppearance();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
