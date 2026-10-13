import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { evaluate, hardware, initCore, models } from './core/index.ts';
import './index.css';
import { toScenario, useStore } from './state/store.ts';
import { installTestHook } from './state/testHook.ts';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no #root element');
}

// Only `vite build --mode test` takes this branch; a normal build drops the hook.
if (import.meta.env.MODE === 'test') {
  installTestHook();
}

await initCore();
const MODEL = 'qwen3-8b';
const model = models().find((m) => m.id === MODEL);
if (!model) throw new Error(`the core has no ${MODEL} preset`);
useStore.getState().setEvaluator((knobs) => evaluate('h100-sxm', MODEL, toScenario(knobs)));

createRoot(root).render(
  <StrictMode>
    <App hardware={hardware('h100-sxm')} model={model} />
  </StrictMode>,
);
