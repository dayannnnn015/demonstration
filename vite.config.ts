import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

// The Express API owns every route except the static bundle, so the app builds
// into public/ and the server hands out web/app.html for /app and web/site.html for the front page.
// Neither is index.html: Vercel's CDN would serve that at / before the server's own route.
export default defineConfig({
  root: 'web',
  // The release the bundle was built from, compared with the server's to notice a newer deploy.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    {
      // The bundle is same-origin, but Vite marks the tags crossorigin, which
      // puts them in CORS mode and makes the API origin allowlist reject them.
      name: 'edunexus-same-origin-assets',
      transformIndexHtml: (html: string) => html.replace(/ crossorigin(="[^"]*")?/g, ''),
    },
  ],
  build: {
    outDir: '../public', emptyOutDir: true, sourcemap: false,
    // Libraries change far less often than the screens. In their own chunk they
    // keep their hash across releases, so the year-long immutable cache the
    // server sets means staff re-download only the application after a deploy.
    rollupOptions: {
      // Two pages: the staff workspace, and the school's public front page.
      input: { app: fileURLToPath(new URL('./web/app.html', import.meta.url)), site: fileURLToPath(new URL('./web/site.html', import.meta.url)) },
      output: {
        manualChunks: (id: string) => (/\/node_modules\/(react|react-dom|scheduler|@supabase)\//.test(id) ? 'vendor' : undefined),
      },
    },
  },
  // '/api/' and not '/api': the bare prefix also matches web/api.ts, which the
  // dev server would then forward to Express instead of serving.
  server: { proxy: { '/api/': 'http://127.0.0.1:3001', '/account/config': 'http://127.0.0.1:3001', '/openapi.json': 'http://127.0.0.1:3001', '/health/': 'http://127.0.0.1:3001' } },
});
