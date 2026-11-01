import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync, createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  root: 'src/renderer',
  base: './',
  plugins: [react(), {
    name: 'local-pdf-assets',
    configureServer(server) {
      server.middlewares.use('/pdf-assets', (request, response, next) => {
        const path = (request.url ?? '').split('?')[0];
        if (!/^\/(cmaps|standard_fonts|wasm)\/[\w][\w.-]*$/.test(path)) { next(); return; }
        const file = resolve(`node_modules/pdfjs-dist${path}`);
        if (!existsSync(file)) { next(); return; }
        response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        createReadStream(file).pipe(response);
      });
    },
    closeBundle() {
      for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
        mkdirSync(resolve('dist/renderer/pdf-assets'), { recursive: true });
        cpSync(resolve(`node_modules/pdfjs-dist/${folder}`), resolve(`dist/renderer/pdf-assets/${folder}`), { recursive: true });
      }
    },
  }, ...(command === 'serve' ? [{
    name: 'development-csp',
    transformIndexHtml: (html: string) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173 ws://127.0.0.1:5174"),
  }] : [])],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
}));
