import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';
import { installTestHook } from './state/testHook.ts';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no #root element');
}

// Only `vite build --mode test` takes this branch; a normal build drops the hook.
if (import.meta.env.MODE === 'test') {
  installTestHook();
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
