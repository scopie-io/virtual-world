import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { build as esbuild } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const api = 'http://localhost:8787';

/**
 * The demo backend (src/demo/sw.ts) is a service worker: one classic script at the site root, plus SQLite's .wasm.
 * It is bundled on its own — it shares the server code, not the app bundle. Dev: built on request. Build: emitted to dist/.
 */
function demoServiceWorker(): Plugin {
  const wasm = resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
  const bundle = async (minify: boolean) => {
    const out = await esbuild({
      entryPoints: [resolve(__dirname, 'src/demo/sw.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', minify, legalComments: 'none',
      external: ['fs', 'path', 'crypto'], // sql.js only reaches for these under Node
      logLevel: 'silent',
    });
    return out.outputFiles[0]!.text;
  };
  return {
    name: 'mission-x-demo-sw',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path === '/demo-sw.js') {
          try { const js = await bundle(false); res.setHeader('content-type', 'text/javascript; charset=utf-8'); res.setHeader('cache-control', 'no-cache'); res.end(js); }
          catch (e) { res.statusCode = 500; res.end(`console.error(${JSON.stringify(String(e))})`); }
        } else if (path === '/sql-wasm.wasm') { res.setHeader('content-type', 'application/wasm'); res.end(readFileSync(wasm)); }
        else next();
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'demo-sw.js', source: await bundle(true) });
      this.emitFile({ type: 'asset', fileName: 'sql-wasm.wasm', source: readFileSync(wasm) });
    },
  };
}

export default defineConfig({
  plugins: [preact(), demoServiceWorker()],
  server: { port: 5173, strictPort: true, host: true, proxy: { '/api': api, '/p': api } },
  build: {
    target: 'es2020',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), crew: resolve(__dirname, 'crew.html'), screen: resolve(__dirname, 'screen.html') } },
  },
});
