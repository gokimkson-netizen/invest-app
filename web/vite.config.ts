import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const pub = JSON.parse(fs.readFileSync(path.join(root, 'config/public.json'), 'utf8')) as { worker_url: string };
const workerOrigin = (process.env.WORKER_URL || pub.worker_url || '').replace(/\/+$/, '');
if (workerOrigin && !/^https:\/\/[a-z0-9.-]+$/i.test(workerOrigin)) throw new Error('worker_url 은 https://도메인 형식이어야 합니다');

/** GitHub Pages는 응답 헤더를 못 바꾸므로 CSP를 <meta>로 넣는다. connect-src는 4곳만(3-3). */
function csp(): Plugin {
  const connect = ["'self'", 'https://generativelanguage.googleapis.com', 'https://api.github.com', ...(workerOrigin ? [workerOrigin] : [])].join(' ');
  const policy = [`default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data:`, `font-src 'self'`, `connect-src ${connect}`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`, `worker-src 'self'`].join('; ');
  return { name: 'csp-meta', transformIndexHtml: (html) => html.replace('%CSP%', policy) };
}

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [csp()],
  resolve: { alias: { '@core': path.join(root, 'packages/core/src'), '@config': path.join(root, 'config') } },
  define: { __WORKER_URL__: JSON.stringify(workerOrigin), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2022', modulePreload: { polyfill: false } },
  server: { fs: { allow: [root] } },
});
