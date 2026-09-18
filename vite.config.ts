import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

const api = 'http://localhost:8787';

export default defineConfig({
  plugins: [preact()],
  server: { port: 5173, strictPort: true, host: true, proxy: { '/api': api, '/p': api } },
  build: {
    target: 'es2020',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), crew: resolve(__dirname, 'crew.html'), screen: resolve(__dirname, 'screen.html') } },
  },
});
