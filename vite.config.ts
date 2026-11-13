import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'apps/web',
  plugins: [react(), tailwindcss()],
  build: { target: 'chrome103', cssTarget: 'chrome103', outDir: '../../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
});
