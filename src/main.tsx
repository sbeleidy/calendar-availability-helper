import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ensureTemporal } from './utils/temporal';
import './index.css';
import App from './App.tsx';

ensureTemporal().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
