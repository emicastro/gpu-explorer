import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Pages serves under `/<repo>/`; the deploy workflow sets VITE_BASE (ADR 0007).
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  // `content/` sits next to `web/`, outside the project root (ADR 0005).
  server: { fs: { allow: ['..'] } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
