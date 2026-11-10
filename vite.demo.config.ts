import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The demo's own build, kept apart from the real one on purpose.
 *
 * `vite.config.ts` bundles `app.html` and `site.html` and nothing else, because
 * `demo.html` replaces signing in with a list of synthetic staff and must never
 * be served from the address the school uses. This config exists so the demo
 * can be hosted for a client walkthrough **as its own deployment**, with its
 * own output directory, rather than by adding a page to the production bundle.
 *
 * The identifiers `demo.html` offers are bearer tokens for the throwaway
 * in-memory database `scripts/demo-school.ts` builds. They are not credentials
 * and the real API rejects them: it verifies a token with the sign-in service.
 */
export default defineConfig({
  root: 'web',
  define: { __APP_VERSION__: JSON.stringify('demo') },
  plugins: [
    react(),
    { name: 'edunexus-same-origin-assets', transformIndexHtml: (html: string) => html.replace(/ crossorigin(="[^"]*")?/g, '') },
  ],
  build: {
    outDir: '../public-demo', emptyOutDir: true, sourcemap: false,
    rollupOptions: {
      // The walkthrough needs both: the workspace over synthetic records, and
      // the school's public front page those records feed.
      input: {
        demo: fileURLToPath(new URL('./web/demo.html', import.meta.url)),
        site: fileURLToPath(new URL('./web/site.html', import.meta.url)),
      },
      output: { manualChunks: (id: string) => (/\/node_modules\/(react|react-dom|scheduler|@supabase)\//.test(id) ? 'vendor' : undefined) },
    },
  },
});
